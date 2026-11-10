import { prisma } from "@/shared/db/prisma";
import { LOCATION_PARENT_SELECT } from "@/features/locations/lib/location-fields";
import { dec } from "@/shared/db/serialize-decimal";
import { parseCastSnapshot } from "@/features/preproduction/lib/snapshots";
import { CASTING_PERSON_FIELDS } from "@/features/casting/lib/casting-person-fields";
import {
  ACTOR_FIELDS,
  CAST_SNAPSHOT_FIELDS,
  CHARACTER_FIELDS,
} from "@/features/characters/lib/character-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const sceneBriefSelect = {
  id: true,
  number: true,
  postfix: true,
  episodeNumber: true,
  planSeconds: true,
  cutAt: true,
  summary: true,
  status: true,
  scriptDay: true,
  locations: {
    include: {
      location: { select: { id: true, name: true, sublocation: true, parent: LOCATION_PARENT_SELECT } },
    },
  },
  shootDayScenes: {
    include: {
      shootDay: {
        select: { id: true, date: true, dayNumber: true, unit: true },
      },
    },
  },
} as const;

export async function listCharactersWithCasting(projectId: string) {
  const characters = await prisma.character.findMany({
    where: { projectId },
    include: {
      scenes: {
        include: {
          scene: { select: sceneBriefSelect },
        },
      },
      castingCandidates: {
        where: { status: "APPROVED" },
        include: {
          person: {
            select: {
              id: true,
              lastName: true,
              firstName: true,
              middleName: true,
            },
          },
        },
        take: 1,
      },
      actors: {
        select: { id: true, lastName: true, firstName: true },
        take: 1,
      },
      _count: { select: { scenes: true, castingCandidates: true } },
    },
    orderBy: { name: "asc" },
  });

  // Снимок утверждённого актёра списку не нужен (только «утверждён» и имя) — в браузер не уходит.
  return characters.map((c) => {
    const snapshot = parseCastSnapshot(c.castSnapshot);
    // Хронометраж — без вырезанных сцен
    const planSeconds = c.scenes.reduce(
      (sum, sc) => sum + (sc.scene.cutAt ? 0 : (sc.scene.planSeconds ?? 0)),
      0,
    );
    const approvedCandidate = c.castingCandidates.find(
      (cc) => cc.status === "APPROVED",
    );
    const isApproved = Boolean(snapshot ?? approvedCandidate);
    const approvedPersonName = snapshot
      ? [snapshot.lastName, snapshot.firstName].filter(Boolean).join(" ")
      : approvedCandidate
        ? [approvedCandidate.person.lastName, approvedCandidate.person.firstName]
            .filter(Boolean)
            .join(" ")
        : null;

    return {
      ...pickFinanceFields(c, CHARACTER_FIELDS, false),
      sceneCount: c._count.scenes,
      candidateCount: c._count.castingCandidates,
      planSeconds,
      isApproved,
      approvedPersonName,
    };
  });
}

export type CharacterWithStats = Awaited<
  ReturnType<typeof listCharactersWithCasting>
>[number];

export type CharacterEditSource = Pick<
  CharacterWithStats,
  | "id"
  | "name"
  | "description"
  | "roleRequirements"
  | "roleType"
  | "makeupOffsetMin"
  | "costumeOffsetMin"
>;

/** `canFinanceRead` — фин. просмотр актёров (`ctx.canFinanceRead("actors")`). */
export async function getCharacterDetail(
  projectId: string,
  characterId: string,
  canFinanceRead: boolean,
) {
  const character = await prisma.character.findFirst({
    where: { id: characterId, projectId },
    include: {
      scenes: {
        include: {
          scene: {
            include: {
              locations: {
                include: {
                  location: { select: { id: true, name: true, sublocation: true, parent: LOCATION_PARENT_SELECT } },
                },
              },
            },
          },
        },
      },
      castingCandidates: {
        include: {
          person: true,
          comments: {
            orderBy: { createdAt: "asc" },
            include: { author: { select: { id: true, name: true } } },
          },
        },
        orderBy: { statusChangedAt: "desc" },
      },
      actors: {
        include: {
          overtimeRates: { orderBy: { hourNumber: "asc" } },
          extraPayments: { orderBy: { paymentDate: "asc" } },
        },
      },
    },
  });

  if (!character) return null;

  const snapshot = parseCastSnapshot(character.castSnapshot);
  // Хронометраж — без вырезанных сцен
  const planSeconds = character.scenes.reduce(
    (sum, sc) => sum + (sc.scene.cutAt ? 0 : (sc.scene.planSeconds ?? 0)),
    0,
  );

  return {
    ...pickFinanceFields(character, CHARACTER_FIELDS, false),
    castingCandidates: character.castingCandidates.map((c) => ({
      ...c,
      person: pickFinanceFields(
        { ...c.person, proposedRate: dec(c.person.proposedRate) },
        CASTING_PERSON_FIELDS,
        canFinanceRead,
      ),
      comments: c.comments.map((cm) => ({
        id: cm.id,
        body: cm.body,
        createdAt: cm.createdAt.toISOString(),
        authorName: cm.author.name,
        authorId: cm.author.id,
      })),
    })),
    actors: character.actors.map((a) =>
      pickFinanceFields(
        {
          ...a,
          shiftRate: dec(a.shiftRate),
          taxPercent: dec(a.taxPercent),
          overtimeRates: a.overtimeRates.map((r) => ({
            ...r,
            percentRate: dec(r.percentRate),
            amount: dec(r.amount),
            taxPercent: dec(r.taxPercent),
            taxAmount: dec(r.taxAmount),
            totalWithTax: dec(r.totalWithTax),
          })),
          extraPayments: a.extraPayments.map((p) => ({
            ...p,
            amount: dec(p.amount) ?? 0,
            taxPercent: dec(p.taxPercent),
            taxAmount: dec(p.taxAmount),
            totalWithTax: dec(p.totalWithTax),
          })),
        },
        ACTOR_FIELDS,
        canFinanceRead,
      ),
    ),
    snapshot: snapshot
      ? pickFinanceFields(snapshot, CAST_SNAPSHOT_FIELDS, canFinanceRead)
      : null,
    planSeconds,
  };
}
