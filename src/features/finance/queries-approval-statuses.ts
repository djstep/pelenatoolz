import {
  DEFAULT_APPROVAL_STATUSES,
} from "@/features/finance/lib/approval-statuses";
import { prisma } from "@/shared/db/prisma";

export type ApprovalStatusRow = {
  id: string;
  key: string | null;
  name: string;
  color: string;
  isSystem: boolean;
  sortOrder: number;
};

/** Создаёт системные статусы, если в проекте их ещё нет. */
export async function ensureApprovalStatuses(projectId: string) {
  const existing = await prisma.projectApprovalStatus.findMany({
    where: { projectId },
    select: { key: true },
  });
  const haveKeys = new Set(
    existing.map((r) => r.key).filter((k): k is string => Boolean(k)),
  );
  const missing = DEFAULT_APPROVAL_STATUSES.filter((d) => !haveKeys.has(d.key));
  if (missing.length === 0) return;

  await prisma.projectApprovalStatus.createMany({
    data: missing.map((d) => ({
      projectId,
      key: d.key,
      name: d.name,
      color: d.color,
      isSystem: true,
      sortOrder: d.sortOrder,
    })),
    skipDuplicates: true,
  });
}

export async function listApprovalStatuses(
  projectId: string,
): Promise<ApprovalStatusRow[]> {
  await ensureApprovalStatuses(projectId);
  return prisma.projectApprovalStatus.findMany({
    where: { projectId },
    select: {
      id: true,
      key: true,
      name: true,
      color: true,
      isSystem: true,
      sortOrder: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}
