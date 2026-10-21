import "server-only";

import { ensureApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { prisma } from "@/shared/db/prisma";

/** Для формы: дефолтный статус «Не подписан». */
export async function resolveDefaultStatusId(projectId: string) {
  await ensureApprovalStatuses(projectId);
  const unsigned = await prisma.projectApprovalStatus.findFirst({
    where: { projectId, key: "UNSIGNED" },
    select: { id: true },
  });
  if (unsigned) return { id: unsigned.id };
  const any = await prisma.projectApprovalStatus.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return any ? { id: any.id } : { error: "Нет статусов" as const };
}
