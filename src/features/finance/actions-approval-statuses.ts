"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeApprovalColor } from "@/features/finance/lib/approval-statuses";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type ApprovalStatusActionState = {
  error?: string;
  success?: string;
};

function revalidate(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/finance/settings`);
  revalidatePath(`/ru/projects/${projectId}/finance`);
}

const statusSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().min(4).max(16),
});

export async function createApprovalStatusAction(
  projectId: string,
  _prev: ApprovalStatusActionState,
  formData: FormData,
): Promise<ApprovalStatusActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = statusSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!parsed.success) return { error: "Проверьте название и цвет" };

  const color = normalizeApprovalColor(parsed.data.color);
  if (!color) return { error: "Цвет — hex вида #22c55e" };

  const maxOrder = await prisma.projectApprovalStatus.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  try {
    const row = await prisma.projectApprovalStatus.create({
      data: {
        projectId,
        name: parsed.data.name,
        color,
        isSystem: false,
        sortOrder: (maxOrder._max.sortOrder ?? 100) + 10,
      },
    });

    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.approvalStatus,
      entityId: row.id,
      action: "CREATE",
      summary: `Добавлен статус согласования «${row.name}»`,
    });
  } catch {
    return { error: "Статус с таким названием уже есть" };
  }

  revalidate(projectId);
  return { success: "Статус добавлен" };
}

export async function updateApprovalStatusAction(
  projectId: string,
  statusId: string,
  _prev: ApprovalStatusActionState,
  formData: FormData,
): Promise<ApprovalStatusActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.projectApprovalStatus.findFirst({
    where: { id: statusId, projectId },
    select: { id: true, name: true },
  });
  if (!existing) return { error: "Статус не найден" };

  const parsed = statusSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color"),
  });
  if (!parsed.success) return { error: "Проверьте название и цвет" };

  const color = normalizeApprovalColor(parsed.data.color);
  if (!color) return { error: "Цвет — hex вида #22c55e" };

  try {
    await prisma.projectApprovalStatus.update({
      where: { id: statusId },
      data: {
        name: parsed.data.name,
        color,
      },
    });
  } catch {
    return { error: "Статус с таким названием уже есть" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.approvalStatus,
    entityId: statusId,
    action: "UPDATE",
    summary: `Обновлён статус согласования «${parsed.data.name}»`,
  });

  revalidate(projectId);
  return { success: "Статус сохранён" };
}

export async function deleteApprovalStatusAction(
  projectId: string,
  statusId: string,
): Promise<ApprovalStatusActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.projectApprovalStatus.findFirst({
    where: { id: statusId, projectId },
    select: { id: true, name: true, isSystem: true },
  });
  if (!existing) return { error: "Статус не найден" };
  if (existing.isSystem) {
    return { error: "Системный статус нельзя удалить — можно только переименовать" };
  }

  await prisma.projectApprovalStatus.delete({ where: { id: statusId } });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.approvalStatus,
    entityId: statusId,
    action: "DELETE",
    summary: `Удалён статус согласования «${existing.name}»`,
  });

  revalidate(projectId);
  return { success: "Статус удалён" };
}
