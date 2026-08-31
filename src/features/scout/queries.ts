import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

export async function listScoutCandidates(projectId: string) {
  const rows = await prisma.scoutCandidate.findMany({
    where: { projectId },
    include: {
      location: { select: { id: true, name: true, sublocation: true } },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map((r) => ({
    ...r,
    cost: dec(r.cost),
  }));
}

export async function getScoutCandidate(projectId: string, candidateId: string) {
  return prisma.scoutCandidate.findFirst({
    where: { id: candidateId, projectId },
    include: {
      location: true,
    },
  });
}

export async function listLocationsForScout(projectId: string) {
  return prisma.location.findMany({
    where: { projectId },
    select: { id: true, name: true, sublocation: true },
    orderBy: { name: "asc" },
  });
}
