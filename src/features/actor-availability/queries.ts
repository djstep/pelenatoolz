import type { ActorAvailabilityStatus } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import { toDateKey } from "@/features/actor-availability/lib/status";

const rowInclude = {
  actor: {
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
      characterId: true,
      character: { select: { id: true, name: true } },
    },
  },
  castingPerson: {
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
      photoUrl: true,
    },
  },
  days: true,
} as const;

export async function listAvailabilityRows(projectId: string) {
  return prisma.actorAvailabilityRow.findMany({
    where: { projectId },
    include: rowInclude,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function getAvailabilityRow(projectId: string, rowId: string) {
  return prisma.actorAvailabilityRow.findFirst({
    where: { id: rowId, projectId },
    include: rowInclude,
  });
}

export async function ensureAvailabilityRowForActor(
  projectId: string,
  actorId: string,
) {
  const existing = await prisma.actorAvailabilityRow.findUnique({
    where: { projectId_actorId: { projectId, actorId } },
    include: rowInclude,
  });
  if (existing) return existing;

  const actor = await prisma.actor.findFirst({
    where: { id: actorId, projectId },
  });
  if (!actor) throw new Error("ACTOR_NOT_FOUND");

  const count = await prisma.actorAvailabilityRow.count({ where: { projectId } });
  return prisma.actorAvailabilityRow.create({
    data: { projectId, actorId, sortOrder: count },
    include: rowInclude,
  });
}

export async function ensureAvailabilityRowForCastingPerson(
  projectId: string,
  castingPersonId: string,
) {
  const existing = await prisma.actorAvailabilityRow.findUnique({
    where: { projectId_castingPersonId: { projectId, castingPersonId } },
    include: rowInclude,
  });
  if (existing) return existing;

  const person = await prisma.castingPerson.findFirst({
    where: { id: castingPersonId, projectId },
  });
  if (!person) throw new Error("PERSON_NOT_FOUND");

  const count = await prisma.actorAvailabilityRow.count({ where: { projectId } });
  return prisma.actorAvailabilityRow.create({
    data: { projectId, castingPersonId, sortOrder: count },
    include: rowInclude,
  });
}

export async function listActorsForAvailabilityPicker(projectId: string) {
  return prisma.actor.findMany({
    where: { projectId },
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
      character: { select: { name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

/** Actor IDs busy on our project per calendar date (from КПП scenes). */
export async function buildKppActorBusyMap(projectId: string) {
  const shootDays = await prisma.shootDay.findMany({
    where: { projectId },
    select: {
      date: true,
      scenes: {
        select: {
          scene: {
            select: {
              characters: { select: { characterId: true } },
            },
          },
        },
      },
    },
  });

  const actors = await prisma.actor.findMany({
    where: { projectId, characterId: { not: null } },
    select: { id: true, characterId: true },
  });
  const charToActor = new Map(
    actors
      .filter((a) => a.characterId)
      .map((a) => [a.characterId!, a.id] as const),
  );

  const map = new Map<string, Set<string>>();
  for (const day of shootDays) {
    const key = toDateKey(day.date);
    if (!map.has(key)) map.set(key, new Set());
    const set = map.get(key)!;
    for (const row of day.scenes) {
      for (const sc of row.scene.characters) {
        const actorId = charToActor.get(sc.characterId);
        if (actorId) set.add(actorId);
      }
    }
  }
  return map;
}

export type AvailabilityRow = Awaited<ReturnType<typeof listAvailabilityRows>>[number];

export type KppBusyMap = Map<string, Set<string>>;

export type ManualDayMap = Map<string, Map<string, { status: ActorAvailabilityStatus; comment: string | null }>>;

export function buildManualDayMap(rows: AvailabilityRow[]): ManualDayMap {
  const map: ManualDayMap = new Map();
  for (const row of rows) {
    const rowMap = new Map<string, { status: ActorAvailabilityStatus; comment: string | null }>();
    for (const day of row.days) {
      rowMap.set(toDateKey(day.date), {
        status: day.status,
        comment: day.comment,
      });
    }
    map.set(row.id, rowMap);
  }
  return map;
}

export async function getScheduleAvailabilityBundle(projectId: string) {
  const [rows, kppBusy, actors] = await Promise.all([
    listAvailabilityRows(projectId),
    buildKppActorBusyMap(projectId),
    prisma.actor.findMany({
      where: { projectId, characterId: { not: null } },
      select: { id: true, characterId: true },
    }),
  ]);

  const characterToActor = Object.fromEntries(
    actors
      .filter((a) => a.characterId)
      .map((a) => [a.characterId!, a.id]),
  );

  return {
    rows,
    manualDays: buildManualDayMap(rows),
    kppBusy,
    characterToActor,
  };
}
