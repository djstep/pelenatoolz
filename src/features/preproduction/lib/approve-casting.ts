import type { Prisma } from "@prisma/client";
import { CastingCandidateStatus } from "@prisma/client";
import type { CharacterCastSnapshot } from "@/features/preproduction/lib/snapshots";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { assertInProject } from "@/features/memberships/assert-in-project";
import { resolveApprovedActorFinance } from "@/features/preproduction/lib/approve-finance";
import { prisma } from "@/shared/db/prisma";
import { toOwnUploadPath } from "@/shared/lib/own-upload-url";

type PersonWithRates = {
  photoUrl: string | null;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
  phone: string | null;
  email: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  physicalParams: Prisma.JsonValue;
  skills: string[];
  proposedRate: Prisma.Decimal | null;
  proposedTerms: string | null;
};

export function buildCastSnapshotFromPerson(
  person: PersonWithRates,
  extras?: Partial<CharacterCastSnapshot>,
): CharacterCastSnapshot {
  return {
    photoUrl: person.photoUrl ? toOwnUploadPath(person.photoUrl) : null,
    lastName: person.lastName,
    firstName: person.firstName,
    middleName: person.middleName,
    phone: person.phone,
    email: person.email,
    agentName: person.agentName,
    agentPhone: person.agentPhone,
    agentEmail: person.agentEmail,
    physicalParams:
      person.physicalParams && typeof person.physicalParams === "object"
        ? (person.physicalParams as Record<string, string>)
        : {},
    skills: person.skills ?? [],
    proposedRate: person.proposedRate ? Number(person.proposedRate) : null,
    proposedTerms: person.proposedTerms,
    shiftRate: person.proposedRate ? Number(person.proposedRate) : null,
    approvedAt: new Date().toISOString(),
    ...extras,
  };
}

/**
 * Approve casting candidate: snapshot on Character + payroll Actor + reject others.
 * `canWriteFinance` — фин. правка актёров из серверного контекста (не из браузера):
 * без неё пустые ставка и условия кандидата не стирают значения того же человека.
 */
export async function approveCastingCandidate(
  projectId: string,
  candidateId: string,
  canWriteFinance: boolean,
) {
  const candidate = await prisma.castingCandidate.findFirst({
    where: { id: candidateId, projectId },
    include: { person: true, character: true },
  });
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");

  await assertInProject("CastingCandidate", candidate.id, projectId);
  await assertInProject("Character", candidate.characterId, projectId);

  const hadApproved = await prisma.castingCandidate.findFirst({
    where: {
      projectId,
      characterId: candidate.characterId,
      status: CastingCandidateStatus.APPROVED,
      id: { not: candidateId },
    },
    select: { id: true },
  });

  // «Тот же человек» — по id: человек ранее утверждённого на роль кандидата.
  const previousApproved = candidate.character.sourceCastingCandidateId
    ? await prisma.castingCandidate.findFirst({
        where: { id: candidate.character.sourceCastingCandidateId, projectId },
        select: { personId: true },
      })
    : null;
  const samePerson = previousApproved?.personId === candidate.personId;
  const previousSnapshot =
    candidate.character.castSnapshot && typeof candidate.character.castSnapshot === "object"
      ? (candidate.character.castSnapshot as unknown as CharacterCastSnapshot)
      : null;

  await prisma.$transaction(async (tx) => {
    await tx.castingCandidate.updateMany({
      where: {
        projectId,
        characterId: candidate.characterId,
        id: { not: candidateId },
        // Резерв — запасной вариант на роль: при утверждении другого его не трогаем.
        status: {
          notIn: [CastingCandidateStatus.REJECTED, CastingCandidateStatus.RESERVE],
        },
      },
      data: {
        status: CastingCandidateStatus.REJECTED,
        statusChangedAt: new Date(),
      },
    });

    await tx.castingCandidate.update({
      where: { id: candidateId, projectId },
      data: {
        status: CastingCandidateStatus.APPROVED,
        statusChangedAt: new Date(),
      },
    });

    const existingActor = await tx.actor.findFirst({
      where: { projectId, characterId: candidate.characterId },
    });

    const finance = resolveApprovedActorFinance({
      canWriteFinance,
      samePerson: samePerson && existingActor != null,
      candidate: {
        proposedRate:
          candidate.person.proposedRate != null ? Number(candidate.person.proposedRate) : null,
        proposedTerms: candidate.person.proposedTerms,
      },
      existingActor: existingActor
        ? {
            shiftRate: existingActor.shiftRate != null ? Number(existingActor.shiftRate) : null,
            specialConditions: existingActor.specialConditions,
          }
        : null,
      existingSnapshot: previousSnapshot,
    });
    const snapshot = buildCastSnapshotFromPerson(candidate.person, finance.snapshot);

    await tx.character.update({
      where: { id: candidate.characterId, projectId },
      data: {
        castSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        sourceCastingCandidateId: candidateId,
      },
    });

    const actorData = {
      lastName: candidate.person.lastName,
      firstName: candidate.person.firstName,
      middleName: candidate.person.middleName,
      phone1: candidate.person.phone,
      email: candidate.person.email,
      agentName: candidate.person.agentName,
      agentPhone: candidate.person.agentPhone,
      agentEmail: candidate.person.agentEmail,
      tags: candidate.person.tags,
      specialConditions: finance.actor.specialConditions,
      shiftRate: finance.actor.shiftRate,
    };

    if (existingActor) {
      await tx.actor.update({
        where: { id: existingActor.id, projectId },
        data: actorData,
      });
    } else {
      await tx.actor.create({
        data: {
          projectId,
          characterId: candidate.characterId,
          ...actorData,
        },
      });
    }
  });

  return {
    characterId: candidate.characterId,
    characterName: candidate.character.name,
    personName: fullNameFromParts(candidate.person),
    replacedPrevious: Boolean(hadApproved),
  };
}
