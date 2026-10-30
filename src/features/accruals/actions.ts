"use server";

import { AccrualType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { computeTaxAmounts } from "@/features/accruals/lib/labels";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { checkBudgetItemsUsable } from "@/features/smeta/budget-item-access";
import type { SmetaAccessContext } from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type AccrualActionState = { error?: string; success?: string; id?: string };

function revalidateAccruals(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/accruals`);
  revalidatePath(`/ru/projects/${projectId}/accruals/shift-entry`);
  revalidatePath(`/ru/projects/${projectId}/finance`);
}

const optionalId = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().cuid().nullable(),
);

const rowSchema = z.object({
  budgetItemId: optionalId,
  counterpartyId: optionalId,
  amount: z.coerce.number().positive().max(1_000_000_000),
  quantity: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  taxPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  date: z.string().min(1),
  groupUnit: z.string().trim().max(80).optional().nullable(),
  type: z.enum(AccrualType),
  shootDayId: optionalId,
  comment: z.string().trim().max(2000).optional().nullable(),
});

/** У начисления из отчёта смены руками меняются только статья, контрагент и примечание. */
const reportRowSchema = z.object({
  budgetItemId: optionalId,
  counterpartyId: optionalId,
  comment: z.string().trim().max(2000).optional().nullable(),
});

function parseTaxPercent(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readRow(formData: FormData) {
  return rowSchema.safeParse({
    budgetItemId: formData.get("budgetItemId"),
    counterpartyId: formData.get("counterpartyId"),
    amount: formData.get("amount"),
    quantity: formData.get("quantity") || null,
    taxPercent: parseTaxPercent(formData.get("taxPercent")),
    date: formData.get("date"),
    groupUnit: formData.get("groupUnit") || null,
    type: formData.get("type") || AccrualType.ONE_TIME,
    shootDayId: formData.get("shootDayId"),
    comment: formData.get("comment") || null,
  });
}

/**
 * Ссылки из браузера: статья (из проекта, действующая, из сметы, которую пользователь видит;
 * уже стоящую — `keepItemId` — можно оставить), контрагенты и съёмочный день из проекта.
 */
async function validateRefs(
  projectId: string,
  access: SmetaAccessContext,
  refs: {
    budgetItemIds: (string | null)[];
    counterpartyIds: (string | null)[];
    shootDayId?: string | null;
  },
  keepItemId?: string | null,
): Promise<string | null> {
  const itemError = await checkBudgetItemsUsable(
    projectId,
    access,
    refs.budgetItemIds,
    [keepItemId],
  );
  if (itemError) return itemError;

  const counterpartyIds = refs.counterpartyIds.filter((id): id is string => !!id);
  try {
    await assertInProject("Counterparty", counterpartyIds, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return "Контрагент не найден";
    throw error;
  }
  try {
    await assertInProject("ShootDay", refs.shootDayId ?? [], projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return "Съёмочный день не найден";
    throw error;
  }
  return null;
}

export async function createAccrualAction(
  projectId: string,
  _prev: AccrualActionState,
  formData: FormData,
): Promise<AccrualActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = readRow(formData);
  if (!parsed.success) return { error: "Проверьте данные начисления" };
  if (!parsed.data.counterpartyId) return { error: "Укажите контрагента" };

  const err = await validateRefs(projectId, ctx, {
    budgetItemIds: [parsed.data.budgetItemId],
    counterpartyIds: [parsed.data.counterpartyId],
    shootDayId: parsed.data.shootDayId,
  });
  if (err) return { error: err };

  const tax = computeTaxAmounts(
    parsed.data.amount,
    parsed.data.taxPercent ?? null,
  );

  let groupUnit = parsed.data.groupUnit?.trim() || null;
  if (!groupUnit && parsed.data.shootDayId) {
    const day = await prisma.shootDay.findFirst({
      where: { id: parsed.data.shootDayId, projectId },
      select: { unit: true },
    });
    groupUnit = day?.unit ?? null;
  }

  const row = await prisma.accrual.create({
    data: {
      projectId,
      budgetItemId: parsed.data.budgetItemId,
      counterpartyId: parsed.data.counterpartyId,
      amount: parsed.data.amount,
      quantity: parsed.data.quantity ?? null,
      taxPercent: parsed.data.taxPercent ?? null,
      taxAmount: tax.taxAmount,
      amountWithTax: tax.amountWithTax,
      date: new Date(`${parsed.data.date}T12:00:00.000Z`),
      groupUnit,
      type: parsed.data.type,
      shootDayId: parsed.data.shootDayId,
      comment: parsed.data.comment || null,
      createdById: ctx.user.id,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.accrual,
    entityId: row.id,
    action: "CREATE",
    summary: `Начисление ${parsed.data.amount}`,
    changes: { budgetItemId: parsed.data.budgetItemId },
  });

  revalidateAccruals(projectId);
  return { success: "Начисление добавлено", id: row.id };
}

export async function updateAccrualAction(
  projectId: string,
  accrualId: string,
  _prev: AccrualActionState,
  formData: FormData,
): Promise<AccrualActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.accrual.findFirst({
    where: { id: accrualId, projectId },
    select: {
      id: true,
      reportPart: true,
      budgetItemId: true,
      counterpartyId: true,
      editedManually: true,
    },
  });
  if (!existing) return { error: "Начисление не найдено" };

  if (existing.reportPart) {
    const parsed = reportRowSchema.safeParse({
      budgetItemId: formData.get("budgetItemId"),
      counterpartyId: formData.get("counterpartyId"),
      comment: formData.get("comment") || null,
    });
    if (!parsed.success) return { error: "Проверьте данные" };

    const err = await validateRefs(
      projectId,
      ctx,
      {
        budgetItemIds: [parsed.data.budgetItemId],
        counterpartyIds: [parsed.data.counterpartyId],
      },
      existing.budgetItemId,
    );
    if (err) return { error: err };

    const changedByHand =
      parsed.data.budgetItemId !== existing.budgetItemId ||
      parsed.data.counterpartyId !== existing.counterpartyId;
    await prisma.accrual.update({
      where: { id: accrualId },
      data: {
        budgetItemId: parsed.data.budgetItemId,
        counterpartyId: parsed.data.counterpartyId,
        comment: parsed.data.comment || null,
        editedManually: existing.editedManually || changedByHand,
      },
    });
    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.accrual,
      entityId: accrualId,
      action: "UPDATE",
      summary: "Начисление из отчёта смены: статья / контрагент",
      changes: {
        budgetItemId: [existing.budgetItemId, parsed.data.budgetItemId],
        counterpartyId: [existing.counterpartyId, parsed.data.counterpartyId],
      },
    });
    revalidateAccruals(projectId);
    return { success: "Сохранено" };
  }

  const parsed = readRow(formData);
  if (!parsed.success) return { error: "Проверьте данные" };
  if (!parsed.data.counterpartyId) return { error: "Укажите контрагента" };

  const err = await validateRefs(
    projectId,
    ctx,
    {
      budgetItemIds: [parsed.data.budgetItemId],
      counterpartyIds: [parsed.data.counterpartyId],
      shootDayId: parsed.data.shootDayId,
    },
    existing.budgetItemId,
  );
  if (err) return { error: err };

  const tax = computeTaxAmounts(
    parsed.data.amount,
    parsed.data.taxPercent ?? null,
  );

  await prisma.accrual.update({
    where: { id: accrualId },
    data: {
      budgetItemId: parsed.data.budgetItemId,
      counterpartyId: parsed.data.counterpartyId,
      amount: parsed.data.amount,
      quantity: parsed.data.quantity ?? null,
      taxPercent: parsed.data.taxPercent ?? null,
      taxAmount: tax.taxAmount,
      amountWithTax: tax.amountWithTax,
      date: new Date(`${parsed.data.date}T12:00:00.000Z`),
      groupUnit: parsed.data.groupUnit?.trim() || null,
      type: parsed.data.type,
      shootDayId: parsed.data.shootDayId,
      comment: parsed.data.comment || null,
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.accrual,
    entityId: accrualId,
    action: "UPDATE",
    summary: `Начисление ${parsed.data.amount}`,
    changes: { budgetItemId: [existing.budgetItemId, parsed.data.budgetItemId] },
  });

  revalidateAccruals(projectId);
  return { success: "Сохранено" };
}

/** Удалить начисление. Возвращает текст отказа или null. */
export async function deleteAccrualAction(
  projectId: string,
  accrualId: string,
): Promise<string | null> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return "Недостаточно прав";

  const existing = await prisma.accrual.findFirst({
    where: { id: accrualId, projectId },
    select: { reportPart: true, reportZeroedAt: true, workRowId: true },
  });
  if (!existing) return "Начисление не найдено";
  // Пока строка отчёта на месте и не обнулена, отчёт создал бы начисление заново.
  if (existing.reportPart && existing.workRowId && !existing.reportZeroedAt) {
    return "Это начисление из отчёта смены: сумма меняется в отчёте. Удалить можно после того, как строку в отчёте обнулят или удалят.";
  }

  await prisma.accrual.deleteMany({ where: { id: accrualId, projectId } });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.accrual,
    entityId: accrualId,
    action: "DELETE",
    summary: existing.reportPart
      ? "Удалено начисление из отчёта смены (обнулено в отчёте)"
      : "Удалено начисление",
  });
  revalidateAccruals(projectId);
  return null;
}

/** Mass create PER_SHIFT accruals for a shoot day. */
export async function createShiftAccrualsBatchAction(
  projectId: string,
  payload: unknown,
): Promise<AccrualActionState & { created?: number }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const schema = z.object({
    shootDayId: z.string().cuid(),
    date: z.string().min(1),
    groupUnit: z.string().trim().max(80).optional().nullable(),
    rows: z
      .array(
        z.object({
          budgetItemId: optionalId,
          counterpartyId: z.string().cuid(),
          amount: z.coerce.number().positive().max(1_000_000_000),
          quantity: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
          taxPercent: z.coerce.number().min(0).max(100).optional().nullable(),
          comment: z.string().trim().max(2000).optional().nullable(),
        }),
      )
      .min(1)
      .max(200),
  });

  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Проверьте строки начислений" };

  const day = await prisma.shootDay.findFirst({
    where: { id: parsed.data.shootDayId, projectId },
    select: { id: true, unit: true },
  });
  if (!day) return { error: "Съёмочный день не найден" };

  const err = await validateRefs(projectId, ctx, {
    budgetItemIds: parsed.data.rows.map((r) => r.budgetItemId),
    counterpartyIds: parsed.data.rows.map((r) => r.counterpartyId),
  });
  if (err) return { error: err };

  const groupUnit =
    parsed.data.groupUnit?.trim() || day.unit || null;
  const date = new Date(`${parsed.data.date}T12:00:00.000Z`);

  let created = 0;
  for (const row of parsed.data.rows) {
    const tax = computeTaxAmounts(row.amount, row.taxPercent ?? null);
    await prisma.accrual.create({
      data: {
        projectId,
        budgetItemId: row.budgetItemId,
        counterpartyId: row.counterpartyId,
        amount: row.amount,
        quantity: row.quantity ?? 1,
        taxPercent: row.taxPercent ?? null,
        taxAmount: tax.taxAmount,
        amountWithTax: tax.amountWithTax,
        date,
        groupUnit,
        type: AccrualType.PER_SHIFT,
        shootDayId: day.id,
        comment: row.comment || null,
        createdById: ctx.user.id,
      },
    });
    created += 1;
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.accrual,
    entityId: day.id,
    action: "CREATE",
    summary: `Посменные начисления: ${created} шт.`,
  });

  revalidateAccruals(projectId);
  return { success: `Добавлено начислений: ${created}`, created };
}
