"use server";

import { BudgetCategory } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type BudgetActionState = { error?: string; success?: string };

function revalidateBudget(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/budget`);
  revalidatePath(`/ru/projects/${projectId}`);
}

const lineSchema = z.object({
  category: z.enum(BudgetCategory),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unitCost: z.coerce.number().min(0).max(1_000_000_000),
  planned: z.coerce.number().min(0).max(1_000_000_000).optional(),
  actual: z.coerce.number().min(0).max(1_000_000_000).optional(),
});

export async function createBudgetLineAction(
  projectId: string,
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) {
    return { error: "Недостаточно прав" };
  }

  const quantity = Number(formData.get("quantity") || 1);
  const unitCost = Number(formData.get("unitCost") || 0);
  const plannedRaw = formData.get("planned");
  const planned =
    plannedRaw !== null && String(plannedRaw).trim() !== ""
      ? Number(plannedRaw)
      : quantity * unitCost;

  const parsed = lineSchema.safeParse({
    category: formData.get("category") || "OTHER",
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    quantity,
    unitCost,
    planned,
    actual: formData.get("actual") || 0,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные статьи" };
  }

  const maxOrder = await prisma.budgetLine.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const line = await prisma.budgetLine.create({
    data: {
      projectId,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      quantity: parsed.data.quantity,
      unitCost: parsed.data.unitCost,
      planned: parsed.data.planned ?? planned,
      actual: parsed.data.actual ?? 0,
      sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.budgetLine,
    entityId: line.id,
    action: "CREATE",
    summary: `Статья сметы: ${line.title}`,
  });

  revalidateBudget(projectId);
  return { success: "Статья добавлена" };
}

export async function updateBudgetLineAction(
  projectId: string,
  lineId: string,
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) {
    return { error: "Недостаточно прав" };
  }

  const quantity = Number(formData.get("quantity") || 1);
  const unitCost = Number(formData.get("unitCost") || 0);
  const plannedRaw = formData.get("planned");
  const planned =
    plannedRaw !== null && String(plannedRaw).trim() !== ""
      ? Number(plannedRaw)
      : quantity * unitCost;

  const parsed = lineSchema.safeParse({
    category: formData.get("category") || "OTHER",
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    quantity,
    unitCost,
    planned,
    actual: formData.get("actual") || 0,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные статьи" };
  }

  await prisma.budgetLine.updateMany({
    where: { id: lineId, projectId },
    data: {
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description,
      quantity: parsed.data.quantity,
      unitCost: parsed.data.unitCost,
      planned: parsed.data.planned ?? planned,
      actual: parsed.data.actual ?? 0,
    },
  });

  revalidateBudget(projectId);
  return { success: "Сохранено" };
}

export async function deleteBudgetLineAction(
  projectId: string,
  lineId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) {
    throw new Error("FORBIDDEN");
  }

  await prisma.budgetLine.deleteMany({ where: { id: lineId, projectId } });
  revalidateBudget(projectId);
}
