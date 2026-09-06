"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  financeVariableKeyFromLabel,
  isSystemFinanceVariableKey,
  SYSTEM_FINANCE_VARIABLES,
} from "@/features/finance/lib/variables";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type FinanceVariableActionState = {
  error?: string;
  success?: string;
};

function revalidate(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/finance`);
  revalidatePath(`/ru/projects/${projectId}/finance/settings`);
  revalidatePath(`/ru/projects/${projectId}/budget`);
}

const valueSchema = z.coerce.number().min(0).max(1_000_000_000);

const customSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: valueSchema,
  notes: z.string().trim().max(500).optional(),
});

export async function upsertSystemFinanceVariableAction(
  projectId: string,
  key: string,
  _prev: FinanceVariableActionState,
  formData: FormData,
): Promise<FinanceVariableActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  if (!isSystemFinanceVariableKey(key)) {
    return { error: "Неизвестная системная переменная" };
  }

  const parsed = z
    .object({
      value: valueSchema,
      notes: z.string().trim().max(500).optional(),
    })
    .safeParse({
      value: formData.get("value"),
      notes: formData.get("notes") || undefined,
    });
  if (!parsed.success) return { error: "Проверьте значение" };

  const def = SYSTEM_FINANCE_VARIABLES.find((v) => v.key === key)!;

  await prisma.projectFinanceVariable.upsert({
    where: { projectId_key: { projectId, key } },
    create: {
      projectId,
      key,
      label: def.label,
      value: parsed.data.value,
      isSystem: true,
      sortOrder: def.sortOrder,
      notes: parsed.data.notes ?? null,
    },
    update: {
      value: parsed.data.value,
      notes: parsed.data.notes ?? null,
      label: def.label,
      isSystem: true,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.financeVariable,
    entityId: key,
    action: "UPDATE",
    summary: `Переменная ${def.label} = ${parsed.data.value}`,
  });

  revalidate(projectId);
  return { success: "Сохранено" };
}

export async function resetSystemFinanceVariableAction(
  projectId: string,
  key: string,
): Promise<FinanceVariableActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };
  if (!isSystemFinanceVariableKey(key)) {
    return { error: "Неизвестная системная переменная" };
  }

  await prisma.projectFinanceVariable.deleteMany({
    where: { projectId, key, isSystem: true },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.financeVariable,
    entityId: key,
    action: "UPDATE",
    summary: `Сброс переменной ${key} к параметрам проекта`,
  });

  revalidate(projectId);
  return { success: "Сброшено к параметрам проекта" };
}

export async function createCustomFinanceVariableAction(
  projectId: string,
  _prev: FinanceVariableActionState,
  formData: FormData,
): Promise<FinanceVariableActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = customSchema.safeParse({
    label: formData.get("label"),
    value: formData.get("value"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные переменной" };

  let key = financeVariableKeyFromLabel(parsed.data.label);
  const existing = await prisma.projectFinanceVariable.findFirst({
    where: { projectId, key },
  });
  if (existing) {
    key = `${key}_${Date.now().toString(36).toUpperCase()}`;
  }

  const maxOrder = await prisma.projectFinanceVariable.aggregate({
    where: { projectId, isSystem: false },
    _max: { sortOrder: true },
  });

  const row = await prisma.projectFinanceVariable.create({
    data: {
      projectId,
      key,
      label: parsed.data.label,
      value: parsed.data.value,
      isSystem: false,
      sortOrder: Math.max(10, (maxOrder._max.sortOrder ?? 9) + 1),
      notes: parsed.data.notes ?? null,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.financeVariable,
    entityId: row.id,
    action: "CREATE",
    summary: `Переменная ${row.label} = ${parsed.data.value}`,
  });

  revalidate(projectId);
  return { success: "Переменная добавлена" };
}

export async function updateCustomFinanceVariableAction(
  projectId: string,
  variableId: string,
  _prev: FinanceVariableActionState,
  formData: FormData,
): Promise<FinanceVariableActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.projectFinanceVariable.findFirst({
    where: { id: variableId, projectId, isSystem: false },
  });
  if (!existing) return { error: "Переменная не найдена" };

  const parsed = customSchema.safeParse({
    label: formData.get("label"),
    value: formData.get("value"),
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  await prisma.projectFinanceVariable.update({
    where: { id: variableId },
    data: {
      label: parsed.data.label,
      value: parsed.data.value,
      notes: parsed.data.notes ?? null,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.financeVariable,
    entityId: variableId,
    action: "UPDATE",
    summary: `Переменная ${parsed.data.label} = ${parsed.data.value}`,
  });

  revalidate(projectId);
  return { success: "Сохранено" };
}

export async function deleteCustomFinanceVariableAction(
  projectId: string,
  variableId: string,
): Promise<FinanceVariableActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.projectFinanceVariable.findFirst({
    where: { id: variableId, projectId, isSystem: false },
  });
  if (!existing) return { error: "Переменная не найдена" };

  await prisma.budgetLine.updateMany({
    where: { projectId, quantityVariableKey: existing.key },
    data: { quantityVariableKey: null },
  });

  await prisma.projectFinanceVariable.delete({ where: { id: variableId } });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.financeVariable,
    entityId: variableId,
    action: "DELETE",
    summary: `Удалена переменная ${existing.label}`,
  });

  revalidate(projectId);
  return { success: "Удалено" };
}
