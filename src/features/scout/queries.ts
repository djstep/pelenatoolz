import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

const scoutInclude = {
  locationLinks: {
    include: {
      location: { select: { id: true, name: true, sublocation: true } },
    },
  },
} as const;

export async function listScoutCandidates(projectId: string) {
  const rows = await prisma.scoutCandidate.findMany({
    where: { projectId },
    include: scoutInclude,
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map((r) => ({
    ...r,
    cost: dec(r.cost),
  }));
}

export async function getScoutCandidate(projectId: string, candidateId: string) {
  const row = await prisma.scoutCandidate.findFirst({
    where: { id: candidateId, projectId },
    include: scoutInclude,
  });
  if (!row) return null;
  return { ...row, cost: dec(row.cost) };
}

export async function listLocationsForScout(projectId: string) {
  return prisma.location.findMany({
    where: { projectId },
    select: { id: true, name: true, sublocation: true },
    orderBy: [{ name: "asc" }, { sublocation: "asc" }],
  });
}

export type ScoutCandidateRow = Awaited<
  ReturnType<typeof listScoutCandidates>
>[number];

export type ScoutCandidateDetail = NonNullable<
  Awaited<ReturnType<typeof getScoutCandidate>>
>;
