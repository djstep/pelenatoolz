import type { Prisma } from "@prisma/client";
import {
  auditionKindFromCount,
  type AuditionFilters,
  type AuditionKind,
} from "@/features/auditions/lib/types";
import { parseDateInput } from "@/features/schedule/lib/date-range";
import { prisma } from "@/shared/db/prisma";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";

const auditionInclude = {
  videoFile: true,
  scene: {
    select: {
      id: true,
      episodeNumber: true,
      number: true,
      postfix: true,
      title: true,
    },
  },
  actors: {
    include: {
      person: {
        select: {
          id: true,
          lastName: true,
          firstName: true,
          middleName: true,
          photoUrl: true,
        },
      },
      character: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.AuditionInclude;

export type AuditionRow = Awaited<ReturnType<typeof listAuditions>>[number];

export async function listAuditions(
  projectId: string,
  filters: AuditionFilters = {},
) {
  const where: Prisma.AuditionWhereInput = { projectId };

  if (filters.personId || filters.characterId) {
    where.actors = {
      some: {
        ...(filters.personId ? { personId: filters.personId } : {}),
        ...(filters.characterId ? { characterId: filters.characterId } : {}),
      },
    };
  }
  if (filters.sceneId) where.sceneId = filters.sceneId;
  if (filters.selfTape === "yes") where.isSelfTape = true;
  if (filters.selfTape === "no") where.isSelfTape = false;

  const dateFrom = filters.dateFrom ? parseDateInput(filters.dateFrom) : null;
  const dateTo = filters.dateTo ? parseDateInput(filters.dateTo) : null;
  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) where.date.gte = dateFrom;
    if (dateTo) where.date.lte = dateTo;
  }

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { comment: { contains: q, mode: "insensitive" } },
      { externalUrl: { contains: q, mode: "insensitive" } },
      {
        actors: {
          some: {
            OR: [
              { person: { lastName: { contains: q, mode: "insensitive" } } },
              { person: { firstName: { contains: q, mode: "insensitive" } } },
              { character: { name: { contains: q, mode: "insensitive" } } },
            ],
          },
        },
      },
      {
        scene: {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { title: { contains: q, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const rows = await prisma.audition.findMany({
    where,
    include: auditionInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  const withKind = rows.map((row) => {
    const kind = auditionKindFromCount(row.actors.length);
    return {
      ...row,
      kind,
      kindLabel:
        kind === "solo"
          ? "Сольная"
          : kind === "pair"
            ? "Парная"
            : "Ансамблевая",
      actorNames: row.actors.map((a) => fullNameFromParts(a.person)),
    };
  });

  if (filters.kind && filters.kind !== "ALL") {
    return withKind.filter((r) => r.kind === filters.kind);
  }
  return withKind;
}

export async function listAuditionsForPerson(
  projectId: string,
  personId: string,
) {
  return listAuditions(projectId, { personId });
}

export async function getAudition(projectId: string, auditionId: string) {
  const row = await prisma.audition.findFirst({
    where: { id: auditionId, projectId },
    include: auditionInclude,
  });
  if (!row) return null;
  const kind = auditionKindFromCount(row.actors.length);
  return { ...row, kind };
}

export async function listScenesBriefForAuditions(projectId: string) {
  return prisma.scene.findMany({
    where: { projectId },
    select: {
      id: true,
      episodeNumber: true,
      number: true,
      postfix: true,
      title: true,
    },
    orderBy: [{ episodeNumber: "asc" }, { sortOrder: "asc" }],
  });
}

export async function listCastingPeopleBrief(projectId: string) {
  const people = await prisma.castingPerson.findMany({
    where: { projectId },
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return people.map((p) => ({
    ...p,
    label: fullNameFromParts(p),
  }));
}

export function matchesKind(
  actorCount: number,
  kind: AuditionKind | "ALL" | undefined,
) {
  if (!kind || kind === "ALL") return true;
  return auditionKindFromCount(actorCount) === kind;
}
