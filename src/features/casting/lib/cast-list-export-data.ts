import { prisma } from "@/shared/db/prisma";
import { toDateKey } from "@/features/actor-availability/lib/status";
import { PHYSICAL_PARAM_LABELS } from "@/features/preproduction/lib/snapshots";
import { actorRoleTypeLabels } from "@/shared/i18n/domain-labels";
import { castingStatusLabels } from "@/features/preproduction/lib/status-labels";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import {
  auditionKindFromCount,
  type AuditionKind,
} from "@/features/auditions/lib/types";
import type { CastingCandidateStatus } from "@prisma/client";

export type CastListExportBundle = {
  project: { id: string; name: string; fullName: string | null };
  character: {
    id: string;
    name: string;
    description: string | null;
    roleRequirements: string | null;
    roleType: string | null;
    roleTypeLabel: string | null;
  };
  candidates: CastListExportCandidate[];
  locale: string;
};

export type CastListExportComment = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

export type CastListExportAudition = {
  id: string;
  date: Date;
  time: string | null;
  isFavorite: boolean;
  isSelfTape: boolean;
  comment: string | null;
  externalUrl: string | null;
  kind: AuditionKind;
  kindLabel: string;
  videoUrl: string | null;
  actors: {
    personId: string;
    personLabel: string;
    characterId: string | null;
    characterName: string | null;
  }[];
};

export type CastListExportCandidate = {
  id: string;
  status: CastingCandidateStatus;
  statusLabel: string;
  rating: number | null;
  notes: string | null;
  createdAt: Date;
  person: {
    id: string;
    photoUrl: string | null;
    lastName: string;
    firstName: string | null;
    middleName: string | null;
    label: string;
    birthDate: Date | null;
    education: string | null;
    filmography: string | null;
    phone: string | null;
    email: string | null;
    agentName: string | null;
    agentPhone: string | null;
    agentEmail: string | null;
    physicalParams: Record<string, string>;
    skills: string[];
    notes: string | null;
  };
  comments: CastListExportComment[];
  auditions: CastListExportAudition[];
};

function ageFromBirthDate(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function formatPhysicalParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${PHYSICAL_PARAM_LABELS[k] ?? k}: ${v}`)
    .join("; ");
}

export function candidateAgeYears(birthDate: Date | null): number | null {
  return ageFromBirthDate(birthDate);
}

export async function loadCastListExportBundle(
  projectId: string,
  characterId: string,
  locale = "ru",
): Promise<CastListExportBundle | null> {
  const [project, character] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, fullName: true },
    }),
    prisma.character.findFirst({
      where: { id: characterId, projectId },
      include: {
        castingCandidates: {
          include: {
            person: true,
            comments: {
              orderBy: { createdAt: "asc" },
              include: { author: { select: { id: true, name: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  if (!project || !character) return null;

  const personIds = character.castingCandidates.map((c) => c.personId);
  const auditions =
    personIds.length === 0
      ? []
      : await prisma.audition.findMany({
          where: {
            projectId,
            actors: { some: { personId: { in: personIds } } },
          },
          include: {
            videoFile: { select: { url: true, status: true } },
            actors: {
              include: {
                person: {
                  select: {
                    id: true,
                    lastName: true,
                    firstName: true,
                    middleName: true,
                  },
                },
                character: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        });

  const auditionsByPerson = new Map<string, CastListExportAudition[]>();
  for (const a of auditions) {
    const kind = auditionKindFromCount(a.actors.length);
    const mapped: CastListExportAudition = {
      id: a.id,
      date: a.date,
      time: a.time,
      isFavorite: a.isFavorite,
      isSelfTape: a.isSelfTape,
      comment: a.comment,
      externalUrl: a.externalUrl,
      kind,
      kindLabel:
        kind === "solo" ? "Сольная" : kind === "pair" ? "Парная" : "Ансамблевая",
      videoUrl:
        a.videoFile?.status === "READY" ? (a.videoFile.url ?? null) : null,
      actors: a.actors.map((link) => ({
        personId: link.personId,
        personLabel: fullNameFromParts(link.person),
        characterId: link.characterId,
        characterName: link.character?.name ?? null,
      })),
    };
    for (const link of a.actors) {
      const list = auditionsByPerson.get(link.personId) ?? [];
      if (!list.some((x) => x.id === mapped.id)) list.push(mapped);
      auditionsByPerson.set(link.personId, list);
    }
  }

  return {
    project,
    character: {
      id: character.id,
      name: character.name,
      description: character.description,
      roleRequirements: character.roleRequirements,
      roleType: character.roleType,
      roleTypeLabel: character.roleType
        ? actorRoleTypeLabels[character.roleType]
        : null,
    },
    locale,
    candidates: character.castingCandidates.map((c) => {
      const phys =
        c.person.physicalParams && typeof c.person.physicalParams === "object"
          ? (c.person.physicalParams as Record<string, string>)
          : {};
      return {
        id: c.id,
        status: c.status,
        statusLabel: castingStatusLabels[c.status],
        rating: c.rating,
        notes: c.notes,
        createdAt: c.createdAt,
        person: {
          id: c.person.id,
          photoUrl: c.person.photoUrl,
          lastName: c.person.lastName,
          firstName: c.person.firstName,
          middleName: c.person.middleName,
          label: fullNameFromParts(c.person),
          birthDate: c.person.birthDate,
          education: c.person.education,
          filmography: c.person.filmography,
          phone: c.person.phone,
          email: c.person.email,
          agentName: c.person.agentName,
          agentPhone: c.person.agentPhone,
          agentEmail: c.person.agentEmail,
          physicalParams: phys,
          skills: c.person.skills,
          notes: c.person.notes,
        },
        comments: c.comments.map((cm) => ({
          id: cm.id,
          body: cm.body,
          createdAt: cm.createdAt,
          authorName: cm.author.name,
        })),
        auditions: auditionsByPerson.get(c.personId) ?? [],
      };
    }),
  };
}

/** Serialize dates for client props. */
export function serializeCastListBundle(bundle: CastListExportBundle) {
  return {
    ...bundle,
    candidates: bundle.candidates.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      person: {
        ...c.person,
        birthDate: c.person.birthDate
          ? toDateKey(c.person.birthDate)
          : null,
      },
      comments: c.comments.map((cm) => ({
        ...cm,
        createdAt: cm.createdAt.toISOString(),
      })),
      auditions: c.auditions.map((a) => ({
        ...a,
        date: toDateKey(a.date),
      })),
    })),
  };
}

export type CastListExportBundleClient = ReturnType<
  typeof serializeCastListBundle
>;

