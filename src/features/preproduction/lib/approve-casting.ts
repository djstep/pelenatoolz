import type { Prisma } from "@prisma/client";
import { CastingCandidateStatus } from "@prisma/client";
import type { CharacterCastSnapshot } from "@/features/preproduction/lib/snapshots";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";

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
    photoUrl: person.photoUrl,
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

/** Approve casting candidate: snapshot on Character + payroll Actor + reject others. */
export async function approveCastingCandidate(
  projectId: string,
  candidateId: string,
) {
  const candidate = await prisma.castingCandidate.findFirst({
    where: { id: candidateId, projectId },
    include: { person: true, character: true },
  });
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");

  const snapshot = buildCastSnapshotFromPerson(candidate.person);

  await prisma.$transaction(async (tx) => {
    await tx.castingCandidate.updateMany({
      where: {
        characterId: candidate.characterId,
        id: { not: candidateId },
        status: { not: CastingCandidateStatus.REJECTED },
      },
      data: {
        status: CastingCandidateStatus.REJECTED,
        statusChangedAt: new Date(),
      },
    });

    await tx.castingCandidate.update({
      where: { id: candidateId },
      data: {
        status: CastingCandidateStatus.APPROVED,
        statusChangedAt: new Date(),
      },
    });

    await tx.character.update({
      where: { id: candidate.characterId },
      data: {
        castSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        sourceCastingCandidateId: candidateId,
      },
    });

    const existingActor = await tx.actor.findFirst({
      where: { projectId, characterId: candidate.characterId },
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
      specialConditions: candidate.person.proposedTerms,
      shiftRate: candidate.person.proposedRate,
    };

    if (existingActor) {
      await tx.actor.update({
        where: { id: existingActor.id },
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
  };
}
