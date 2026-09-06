"use server";

import { BudgetCategory, BudgetLineType, BudgetLinkedResourceType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  computeBudgetLinePlanned,
  defaultQuantityVariableKey,
} from "@/features/budget/lib/line-calc";
import { resolveFinanceVariableValue } from "@/features/finance/queries-variables";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type BudgetActionState = { error?: string; success?: string };

function revalidateBudget(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/budget`);
  revalidatePath(`/ru/projects/${projectId}/smeta`);
  revalidatePath(`/ru/projects/${projectId}/accruals`);
  revalidatePath(`/ru/projects/${projectId}`);
}

const lineSchema = z.object({
  category: z.enum(BudgetCategory),
  lineType: z.enum(BudgetLineType),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  unitsCount: z.coerce.number().min(0).max(1_000_000),
  quantity: z.coerce.number().min(0).max(1_000_000),
  quantityVariableKey: z.string().trim().max(64).nullable(),
  quantityAdjustment: z.coerce.number().min(-1_000_000).max(1_000_000),
  unitCost: z.coerce.number().min(0).max(1_000_000_000),
  planned: z.coerce.number().min(0).max(1_000_000_000).optional(),
  actual: z.coerce.number().min(0).max(1_000_000_000).optional(),
  plannedCounterpartyId: z.string().trim().min(1).nullable(),
  taxPercent: z.coerce.number().min(0).max(100).nullable(),
  linkedResourceType: z.enum(BudgetLinkedResourceType).nullable(),
  linkedResourceId: z.string().trim().min(1).nullable(),
});

async function parseBudgetLineForm(projectId: string, formData: FormData) {
  const lineType = (String(formData.get("lineType") || "ONE_TIME") ||
    "ONE_TIME") as BudgetLineType;

  let quantityVariableKey = String(
    formData.get("quantityVariableKey") ?? "",
  ).trim();
  if (!quantityVariableKey) {
    quantityVariableKey = defaultQuantityVariableKey(lineType) ?? "";
  }
  if (lineType === "ONE_TIME") quantityVariableKey = "";

  const quantityAdjustment = Number(formData.get("quantityAdjustment") || 0);
  let quantity = Number(formData.get("quantity") || 1);

  if (quantityVariableKey && lineType !== "ONE_TIME") {
    const resolved = await resolveFinanceVariableValue(
      projectId,
      quantityVariableKey,
    );
    if (resolved == null) {
      return { error: "Неизвестная переменная количества" as const };
    }
    quantity = Math.max(0, resolved + quantityAdjustment);
  } else if (lineType === "ONE_TIME") {
    quantity = 1;
  }

  const unitsCount =
    lineType === "PER_SHIFT"
      ? Number(formData.get("unitsCount") || 1)
      : 1;
  const unitCost = Number(formData.get("unitCost") || 0);

  const plannedRaw = formData.get("planned");
  const autoPlanned = computeBudgetLinePlanned({
    lineType,
    unitsCount,
    quantity,
    unitCost,
  });
  const planned =
    plannedRaw !== null && String(plannedRaw).trim() !== ""
      ? Number(plannedRaw)
      : autoPlanned;

  const counterpartyRaw = String(
    formData.get("plannedCounterpartyId") ?? "",
  ).trim();
  const taxRaw = String(formData.get("taxPercent") ?? "").trim();
  const linkedTypeRaw = String(formData.get("linkedResourceType") ?? "").trim();
  const linkedIdRaw = String(formData.get("linkedResourceId") ?? "").trim();

  const linkedResourceType =
    linkedTypeRaw === "ACTOR" || linkedTypeRaw === "RESOURCE_ITEM"
      ? (linkedTypeRaw as BudgetLinkedResourceType)
      : null;
  const linkedResourceId =
    linkedResourceType && linkedIdRaw ? linkedIdRaw : null;

  const parsed = lineSchema.safeParse({
    category: formData.get("category") || "OTHER",
    lineType,
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    unitsCount,
    quantity,
    quantityVariableKey: quantityVariableKey || null,
    quantityAdjustment: lineType === "ONE_TIME" ? 0 : quantityAdjustment,
    unitCost,
    planned,
    actual: formData.get("actual") || 0,
    plannedCounterpartyId:
      lineType === "ONE_TIME" ? null : counterpartyRaw || null,
    taxPercent:
      lineType === "ONE_TIME" || taxRaw === "" ? null : Number(taxRaw),
    linkedResourceType,
    linkedResourceId,
  });

  if (!parsed.success) {
    return { error: "Проверьте данные статьи" as const };
  }

  if (parsed.data.plannedCounterpartyId) {
    const cp = await prisma.counterparty.findFirst({
      where: { id: parsed.data.plannedCounterpartyId, projectId },
      select: { id: true },
    });
    if (!cp) return { error: "Контрагент не найден" as const };
  }

  if (parsed.data.linkedResourceType === "ACTOR" && parsed.data.linkedResourceId) {
    const actor = await prisma.actor.findFirst({
      where: { id: parsed.data.linkedResourceId, projectId },
      select: { id: true },
    });
    if (!actor) return { error: "Актёр не найден" as const };
  }
  if (
    parsed.data.linkedResourceType === "RESOURCE_ITEM" &&
    parsed.data.linkedResourceId
  ) {
    const item = await prisma.resourceItem.findFirst({
      where: {
        id: parsed.data.linkedResourceId,
        category: { projectId },
      },
      select: { id: true },
    });
    if (!item) return { error: "Ресурс не найден" as const };
  }

  return { data: parsed.data };
}

export async function createBudgetLineAction(
  projectId: string,
  _prev: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("budget:write")) {
    return { error: "Недостаточно прав" };
  }

  const result = await parseBudgetLineForm(projectId, formData);
  if ("error" in result) return { error: result.error };

  const maxOrder = await prisma.budgetLine.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });

  const line = await prisma.budgetLine.create({
    data: {
      projectId,
      category: result.data.category,
      lineType: result.data.lineType,
      title: result.data.title,
      description: result.data.description,
      unitsCount: result.data.unitsCount,
      quantity: result.data.quantity,
      quantityVariableKey: result.data.quantityVariableKey,
      quantityAdjustment: result.data.quantityAdjustment,
      unitCost: result.data.unitCost,
      planned: result.data.planned ?? 0,
      actual: result.data.actual ?? 0,
      plannedCounterpartyId: result.data.plannedCounterpartyId,
      taxPercent: result.data.taxPercent,
      linkedResourceType: result.data.linkedResourceType,
      linkedResourceId: result.data.linkedResourceId,
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

  const result = await parseBudgetLineForm(projectId, formData);
  if ("error" in result) return { error: result.error };

  await prisma.budgetLine.updateMany({
    where: { id: lineId, projectId },
    data: {
      category: result.data.category,
      lineType: result.data.lineType,
      title: result.data.title,
      description: result.data.description,
      unitsCount: result.data.unitsCount,
      quantity: result.data.quantity,
      quantityVariableKey: result.data.quantityVariableKey,
      quantityAdjustment: result.data.quantityAdjustment,
      unitCost: result.data.unitCost,
      planned: result.data.planned ?? 0,
      actual: result.data.actual ?? 0,
      plannedCounterpartyId: result.data.plannedCounterpartyId,
      taxPercent: result.data.taxPercent,
      linkedResourceType: result.data.linkedResourceType,
      linkedResourceId: result.data.linkedResourceId,
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
