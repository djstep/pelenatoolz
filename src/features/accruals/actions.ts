"use server";

import { AccrualType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { computeTaxAmounts } from "@/features/accruals/lib/labels";
import {
  suggestBudgetLineForCounterparty,
  suggestDefaultsForBudgetLine,
} from "@/features/accruals/lib/suggest";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

export type AccrualActionState = { error?: string; success?: string; id?: string };

function revalidateAccruals(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/accruals`);
  revalidatePath(`/ru/projects/${projectId}/accruals/shift-entry`);
  revalidatePath(`/ru/projects/${projectId}/budget`);
  revalidatePath(`/ru/projects/${projectId}/finance`);
}

const rowSchema = z.object({
  budgetLineId: z.string().cuid(),
  counterpartyId: z.string().cuid(),
  amount: z.coerce.number().positive().max(1_000_000_000),
  quantity: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  taxPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  date: z.string().min(1),
  groupUnit: z.string().trim().max(80).optional().nullable(),
  type: z.enum(AccrualType),
  shootDayId: z.string().cuid().optional().nullable(),
  comment: z.string().trim().max(2000).optional().nullable(),
});

function parseTaxPercent(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function validateRefs(
  projectId: string,
  data: z.infer<typeof rowSchema>,
) {
  const [line, cp] = await Promise.all([
    prisma.budgetLine.findFirst({
      where: { id: data.budgetLineId, projectId },
      select: { id: true },
    }),
    prisma.counterparty.findFirst({
      where: { id: data.counterpartyId, projectId },
      select: { id: true },
    }),
  ]);
  if (!line) return "Статья не найдена";
  if (!cp) return "Контрагент не найден";
  if (data.shootDayId) {
    const day = await prisma.shootDay.findFirst({
      where: { id: data.shootDayId, projectId },
      select: { id: true, unit: true },
    });
    if (!day) return "Съёмочный день не найден";
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

  const parsed = rowSchema.safeParse({
    budgetLineId: formData.get("budgetLineId"),
    counterpartyId: formData.get("counterpartyId"),
    amount: formData.get("amount"),
    quantity: formData.get("quantity") || null,
    taxPercent: parseTaxPercent(formData.get("taxPercent")),
    date: formData.get("date"),
    groupUnit: formData.get("groupUnit") || null,
    type: formData.get("type") || AccrualType.ONE_TIME,
    shootDayId: formData.get("shootDayId") || null,
    comment: formData.get("comment") || null,
  });
  if (!parsed.success) return { error: "Проверьте данные начисления" };

  const err = await validateRefs(projectId, parsed.data);
  if (err) return { error: err };

  const tax = computeTaxAmounts(
    parsed.data.amount,
    parsed.data.taxPercent ?? null,
  );

  let groupUnit = parsed.data.groupUnit?.trim() || null;
  if (!groupUnit && parsed.data.shootDayId) {
    const day = await prisma.shootDay.findFirst({
      where: { id: parsed.data.shootDayId },
      select: { unit: true },
    });
    groupUnit = day?.unit ?? null;
  }

  const row = await prisma.accrual.create({
    data: {
      projectId,
      budgetLineId: parsed.data.budgetLineId,
      counterpartyId: parsed.data.counterpartyId,
      amount: parsed.data.amount,
      quantity: parsed.data.quantity ?? null,
      taxPercent: parsed.data.taxPercent ?? null,
      taxAmount: tax.taxAmount,
      amountWithTax: tax.amountWithTax,
      date: new Date(`${parsed.data.date}T12:00:00.000Z`),
      groupUnit,
      type: parsed.data.type,
      shootDayId: parsed.data.shootDayId || null,
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
    select: { id: true },
  });
  if (!existing) return { error: "Начисление не найдено" };

  const parsed = rowSchema.safeParse({
    budgetLineId: formData.get("budgetLineId"),
    counterpartyId: formData.get("counterpartyId"),
    amount: formData.get("amount"),
    quantity: formData.get("quantity") || null,
    taxPercent: parseTaxPercent(formData.get("taxPercent")),
    date: formData.get("date"),
    groupUnit: formData.get("groupUnit") || null,
    type: formData.get("type") || AccrualType.ONE_TIME,
    shootDayId: formData.get("shootDayId") || null,
    comment: formData.get("comment") || null,
  });
  if (!parsed.success) return { error: "Проверьте данные" };

  const err = await validateRefs(projectId, parsed.data);
  if (err) return { error: err };

  const tax = computeTaxAmounts(
    parsed.data.amount,
    parsed.data.taxPercent ?? null,
  );

  await prisma.accrual.update({
    where: { id: accrualId },
    data: {
      budgetLineId: parsed.data.budgetLineId,
      counterpartyId: parsed.data.counterpartyId,
      amount: parsed.data.amount,
      quantity: parsed.data.quantity ?? null,
      taxPercent: parsed.data.taxPercent ?? null,
      taxAmount: tax.taxAmount,
      amountWithTax: tax.amountWithTax,
      date: new Date(`${parsed.data.date}T12:00:00.000Z`),
      groupUnit: parsed.data.groupUnit?.trim() || null,
      type: parsed.data.type,
      shootDayId: parsed.data.shootDayId || null,
      comment: parsed.data.comment || null,
    },
  });

  revalidateAccruals(projectId);
  return { success: "Сохранено" };
}

export async function deleteAccrualAction(projectId: string, accrualId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) throw new Error("FORBIDDEN");

  await prisma.accrual.deleteMany({ where: { id: accrualId, projectId } });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.accrual,
    entityId: accrualId,
    action: "DELETE",
    summary: "Удалено начисление",
  });
  revalidateAccruals(projectId);
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
          budgetLineId: z.string().cuid(),
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

  const groupUnit =
    parsed.data.groupUnit?.trim() || day.unit || null;
  const date = new Date(`${parsed.data.date}T12:00:00.000Z`);

  let created = 0;
  for (const row of parsed.data.rows) {
    const tax = computeTaxAmounts(row.amount, row.taxPercent ?? null);
    await prisma.accrual.create({
      data: {
        projectId,
        budgetLineId: row.budgetLineId,
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

export async function suggestAccrualDefaultsAction(
  projectId: string,
  payload: unknown,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:read")) return { error: "Недостаточно прав" };

  const schema = z.object({
    budgetLineId: z.string().cuid().optional(),
    counterpartyId: z.string().cuid().optional(),
    shootDayId: z.string().cuid().optional().nullable(),
  });
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { error: "Некорректный запрос" };

  if (parsed.data.budgetLineId) {
    const defaults = await suggestDefaultsForBudgetLine(
      projectId,
      parsed.data.budgetLineId,
      parsed.data.shootDayId,
    );
    return { defaults };
  }

  if (parsed.data.counterpartyId) {
    const budgetLineId = await suggestBudgetLineForCounterparty(
      projectId,
      parsed.data.counterpartyId,
    );
    return { budgetLineId };
  }

  return { error: "Укажите статью или контрагента" };
}
