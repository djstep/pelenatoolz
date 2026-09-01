import type { Prisma } from "@prisma/client";
import { ScoutCandidateStatus } from "@prisma/client";
import type { LocationScoutSnapshot } from "@/features/preproduction/lib/snapshots";
import { prisma } from "@/shared/db/prisma";

export function buildScoutSnapshot(candidate: {
  title: string;
  address: string | null;
  cost: Prisma.Decimal | null;
  contactName: string | null;
  contactPhone: string | null;
  photos: Prisma.JsonValue;
  videos: Prisma.JsonValue;
  notes: string | null;
}): LocationScoutSnapshot {
  return {
    title: candidate.title,
    address: candidate.address,
    cost: candidate.cost ? Number(candidate.cost) : null,
    contactName: candidate.contactName,
    contactPhone: candidate.contactPhone,
    photos: Array.isArray(candidate.photos)
      ? (candidate.photos as LocationScoutSnapshot["photos"])
      : [],
    videos: Array.isArray(candidate.videos)
      ? (candidate.videos as LocationScoutSnapshot["videos"])
      : [],
    notes: candidate.notes,
    approvedAt: new Date().toISOString(),
  };
}

export async function approveScoutCandidate(
  projectId: string,
  candidateId: string,
) {
  const candidate = await prisma.scoutCandidate.findFirst({
    where: { id: candidateId, projectId },
    include: {
      locationLinks: { include: { location: true } },
    },
  });
  if (!candidate) throw new Error("SCOUT_NOT_FOUND");
  if (candidate.locationLinks.length === 0) throw new Error("SCOUT_NO_LOCATIONS");

  const locationIds = candidate.locationLinks.map((l) => l.locationId);
  const snapshot = buildScoutSnapshot(candidate);

  await prisma.$transaction(async (tx) => {
    await tx.scoutCandidate.updateMany({
      where: {
        id: { not: candidateId },
        projectId,
        status: { not: ScoutCandidateStatus.REJECTED },
        locationLinks: { some: { locationId: { in: locationIds } } },
      },
      data: {
        status: ScoutCandidateStatus.REJECTED,
        statusChangedAt: new Date(),
      },
    });

    await tx.scoutCandidate.update({
      where: { id: candidateId },
      data: {
        status: ScoutCandidateStatus.APPROVED,
        statusChangedAt: new Date(),
      },
    });

    for (const locationId of locationIds) {
      await tx.location.update({
        where: { id: locationId },
        data: {
          scoutSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          sourceScoutCandidateId: candidateId,
          address: snapshot.address ?? undefined,
          notes: snapshot.notes ?? undefined,
        },
      });
    }
  });

  return {
    locationIds,
    locationNames: candidate.locationLinks.map((l) => l.location.name),
    scoutTitle: candidate.title,
  };
}
