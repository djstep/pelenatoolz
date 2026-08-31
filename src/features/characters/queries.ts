import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";
import { parseCastSnapshot } from "@/features/preproduction/lib/snapshots";

const sceneBriefSelect = {
  id: true,
  number: true,
  postfix: true,
  episodeNumber: true,
  planSeconds: true,
  summary: true,
  status: true,
  scriptDay: true,
  locations: {
    include: {
      location: { select: { id: true, name: true, sublocation: true } },
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

  return characters.map((c) => {
    const snapshot = parseCastSnapshot(c.castSnapshot);
    const planSeconds = c.scenes.reduce(
      (sum, sc) => sum + (sc.scene.planSeconds ?? 0),
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
      ...c,
      snapshot,
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
  "id" | "name" | "description" | "roleRequirements"
>;

export async function getCharacterDetail(projectId: string, characterId: string) {
  const character = await prisma.character.findFirst({
    where: { id: characterId, projectId },
    include: {
      scenes: {
        include: {
          scene: {
            include: {
              locations: { include: { location: true } },
            },
          },
        },
      },
      castingCandidates: {
        include: { person: true },
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
  const planSeconds = character.scenes.reduce(
    (sum, sc) => sum + (sc.scene.planSeconds ?? 0),
    0,
  );

  return {
    ...character,
    castingCandidates: character.castingCandidates.map((c) => ({
      ...c,
      person: {
        ...c.person,
        proposedRate: dec(c.person.proposedRate),
      },
    })),
    actors: character.actors.map((a) => ({
      ...a,
      shiftRate: dec(a.shiftRate),
      forceMajeurePct: dec(a.forceMajeurePct),
      overtimeRates: a.overtimeRates.map((r) => ({
        ...r,
        percentRate: dec(r.percentRate),
        amount: dec(r.amount),
        forceMajeurePct: dec(r.forceMajeurePct),
        forceMajeureAmt: dec(r.forceMajeureAmt),
        totalWithFk: dec(r.totalWithFk),
      })),
      extraPayments: a.extraPayments.map((p) => ({
        ...p,
        amount: dec(p.amount) ?? 0,
        forceMajeurePct: dec(p.forceMajeurePct),
        forceMajeureAmt: dec(p.forceMajeureAmt),
        totalWithFk: dec(p.totalWithFk),
      })),
    })),
    snapshot,
    planSeconds,
  };
}
