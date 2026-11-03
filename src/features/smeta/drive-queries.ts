import "server-only";

import { canExportBudgetToDrive, type BudgetDriveTarget } from "@/features/cloud/lib/budget-drive-export-rules";
import { getProjectDriveExportAvailability } from "@/features/cloud/lib/drive-export-service";
import { projectDriveUnavailableText } from "@/features/cloud/lib/project-drive-export-rules";
import { canSeeProjectDrive } from "@/features/cloud/lib/project-drive-rules";
import { projectDriveActor } from "@/features/cloud/lib/project-drive-service";
import type { requireProjectContext } from "@/features/projects/lib/project-context";
import { isProducerRole } from "@/features/roles/role-rules";

/** Кнопка «На диск…» на странице сметы цеха: null — права выгружать нет (кнопки нет вовсе). */
export type BudgetDriveButton = {
  /** Диск проекта недоступен — подпись вместо кнопки (почему и куда идти). */
  notice: string | null;
};

/**
 * Показывать ли «На диск…»: продюсер или глава этого цеха (решение 8). Цех этого проекта
 * проверила страница. Диск проекта не годится — вместо кнопки понятная подпись.
 */
export async function getBudgetDriveButton(
  ctx: Awaited<ReturnType<typeof requireProjectContext>>,
  departmentId: string,
): Promise<BudgetDriveButton | null> {
  return driveButton(ctx, { kind: "department", departmentId });
}

/** «На диск…» на странице сводной: только продюсерам (решение 8); остальным — ни кнопки, ни подписи. */
export async function getBudgetSummaryDriveButton(
  ctx: Awaited<ReturnType<typeof requireProjectContext>>,
): Promise<BudgetDriveButton | null> {
  return driveButton(ctx, { kind: "summary" });
}

async function driveButton(
  ctx: Awaited<ReturnType<typeof requireProjectContext>>,
  target: BudgetDriveTarget,
): Promise<BudgetDriveButton | null> {
  const actor = { isProducer: isProducerRole(ctx.role), headDepartmentIds: ctx.headDepartmentIds };
  if (!canExportBudgetToDrive(actor, target)) return null;
  const availability = await getProjectDriveExportAvailability(ctx.project.id);
  return {
    notice: availability
      ? projectDriveUnavailableText(availability, canSeeProjectDrive(projectDriveActor(ctx)))
      : null,
  };
}
