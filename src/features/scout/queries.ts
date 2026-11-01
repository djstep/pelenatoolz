import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";
import { SCOUT_CANDIDATE_FIELDS } from "@/features/scout/lib/scout-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const scoutInclude = {
  locationLinks: {
    include: {
      location: { select: { id: true, name: true, sublocation: true } },
    },
  },
} as const;

/** `canFinanceRead` — фин. просмотр объектов (`ctx.canFinanceRead("locations")`). */
export async function listScoutCandidates(projectId: string, canFinanceRead: boolean) {
  const rows = await prisma.scoutCandidate.findMany({
    where: { projectId },
    include: scoutInclude,
    orderBy: [{ updatedAt: "desc" }],
  });

  return rows.map((r) =>
    pickFinanceFields({ ...r, cost: dec(r.cost) }, SCOUT_CANDIDATE_FIELDS, canFinanceRead),
  );
}

/** `canFinanceRead` — фин. просмотр объектов (`ctx.canFinanceRead("locations")`). */
export async function getScoutCandidate(
  projectId: string,
  candidateId: string,
  canFinanceRead: boolean,
) {
  const row = await prisma.scoutCandidate.findFirst({
    where: { id: candidateId, projectId },
    include: scoutInclude,
  });
  if (!row) return null;
  return pickFinanceFields({ ...row, cost: dec(row.cost) }, SCOUT_CANDIDATE_FIELDS, canFinanceRead);
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
