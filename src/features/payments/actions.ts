"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  breakdownSumMatches,
  computeTaxAmounts,
} from "@/features/payments/lib/calc";
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

export type PaymentActionState = {
  error?: string;
  success?: string;
  id?: string;
};

function revalidatePayments(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/payments`);
  revalidatePath(`/ru/projects/${projectId}/finance`);
  revalidatePath(`/ru/projects/${projectId}/accruals`);
}

const breakdownSchema = z.object({
  /** Пусто — «без статьи» */
  budgetItemId: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.string().cuid().nullable(),
  ),
  amount: z.coerce.number().positive().max(1_000_000_000),
  comment: z.string().trim().max(1000).optional().nullable(),
});

const paymentSchema = z.object({
  counterpartyId: z.string().cuid(),
  companyId: z.string().cuid(),
  amount: z.coerce.number().positive().max(1_000_000_000),
  date: z.string().min(1),
  taxPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  comment: z.string().trim().max(2000).optional().nullable(),
  isLocked: z.boolean().optional(),
  breakdown: z.array(breakdownSchema).min(1).max(100),
});

function parseTaxPercent(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Без контрагента платёж не проводится — об этом отдельное сообщение. */
function paymentParseError(error: z.ZodError) {
  return error.issues.some((i) => i.path[0] === "counterpartyId")
    ? "Укажите контрагента — платёж без контрагента провести нельзя"
    : "Проверьте данные платежа";
}

function parseBreakdown(formData: FormData) {
  const raw = String(formData.get("breakdownJson") ?? "[]");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Контрагент и компания — из проекта; статьи разбивки — из проекта, действующие и из смет,
 * которые пользователь видит (статьи, уже стоящие в платеже, — `keepItemIds` — можно оставить).
 */
async function validatePaymentRefs(
  projectId: string,
  access: SmetaAccessContext,
  data: z.infer<typeof paymentSchema>,
  keepItemIds: (string | null)[] = [],
) {
  try {
    await assertInProject("Counterparty", data.counterpartyId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return "Контрагент не найден";
    throw error;
  }
  try {
    await assertInProject("Company", data.companyId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return "Компания не найдена";
    throw error;
  }

  const itemError = await checkBudgetItemsUsable(
    projectId,
    access,
    data.breakdown.map((b) => b.budgetItemId),
    keepItemIds,
  );
  if (itemError) return itemError;

  if (
    !breakdownSumMatches(
      data.amount,
      data.breakdown.map((b) => b.amount),
    )
  ) {
    return "Сумма разбивки должна совпадать с суммой платежа";
  }

  return null;
}

export async function createCashPaymentAction(
  projectId: string,
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const parsed = paymentSchema.safeParse({
    counterpartyId: formData.get("counterpartyId"),
    companyId: formData.get("companyId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    taxPercent: parseTaxPercent(formData.get("taxPercent")),
    comment: formData.get("comment") || null,
    isLocked: formData.get("isLocked") === "on" || formData.get("isLocked") === "true",
    breakdown: parseBreakdown(formData),
  });
  if (!parsed.success) return { error: paymentParseError(parsed.error) };

  const err = await validatePaymentRefs(projectId, ctx, parsed.data);
  if (err) return { error: err };

  const tax = computeTaxAmounts(
    parsed.data.amount,
    parsed.data.taxPercent ?? null,
  );
  const lock = Boolean(parsed.data.isLocked);

  const row = await prisma.cashPayment.create({
    data: {
      projectId,
      counterpartyId: parsed.data.counterpartyId,
      companyId: parsed.data.companyId,
      amount: parsed.data.amount,
      date: new Date(`${parsed.data.date}T12:00:00.000Z`),
      taxPercent: parsed.data.taxPercent ?? null,
      taxAmount: tax.taxAmount,
      amountWithTax: tax.amountWithTax,
      comment: parsed.data.comment || null,
      createdById: ctx.user.id,
      isLocked: lock,
      lockedAt: lock ? new Date() : null,
      lockedById: lock ? ctx.user.id : null,
      breakdown: {
        create: parsed.data.breakdown.map((b, i) => ({
          budgetItemId: b.budgetItemId,
          amount: b.amount,
          comment: b.comment || null,
          sortOrder: i,
        })),
      },
    },
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cashPayment,
    entityId: row.id,
    action: "CREATE",
    summary: `Платёж ${parsed.data.amount}${lock ? " (зафиксирован)" : ""}`,
  });

  revalidatePayments(projectId);
  return { success: "Платёж создан", id: row.id };
}

export async function updateCashPaymentAction(
  projectId: string,
  paymentId: string,
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.cashPayment.findFirst({
    where: { id: paymentId, projectId },
    include: { breakdown: { select: { budgetItemId: true } } },
  });
  if (!existing) return { error: "Платёж не найден" };

  if (existing.isLocked) {
    return {
      error:
        "Платёж зафиксирован. Снимите фиксацию (нужно право «Снятие фиксации платежей»).",
    };
  }

  const parsed = paymentSchema.safeParse({
    counterpartyId: formData.get("counterpartyId"),
    companyId: formData.get("companyId"),
    amount: formData.get("amount"),
    date: formData.get("date"),
    taxPercent: parseTaxPercent(formData.get("taxPercent")),
    comment: formData.get("comment") || null,
    isLocked: formData.get("isLocked") === "on" || formData.get("isLocked") === "true",
    breakdown: parseBreakdown(formData),
  });
  if (!parsed.success) return { error: paymentParseError(parsed.error) };

  const err = await validatePaymentRefs(
    projectId,
    ctx,
    parsed.data,
    existing.breakdown.map((b) => b.budgetItemId),
  );
  if (err) return { error: err };

  const tax = computeTaxAmounts(
    parsed.data.amount,
    parsed.data.taxPercent ?? null,
  );
  const lock = Boolean(parsed.data.isLocked);

  await prisma.$transaction(async (tx) => {
    await tx.cashPaymentBreakdown.deleteMany({ where: { paymentId } });
    await tx.cashPayment.update({
      where: { id: paymentId },
      data: {
        counterpartyId: parsed.data.counterpartyId,
        companyId: parsed.data.companyId,
        amount: parsed.data.amount,
        date: new Date(`${parsed.data.date}T12:00:00.000Z`),
        taxPercent: parsed.data.taxPercent ?? null,
        taxAmount: tax.taxAmount,
        amountWithTax: tax.amountWithTax,
        comment: parsed.data.comment || null,
        isLocked: lock,
        lockedAt: lock ? new Date() : null,
        lockedById: lock ? ctx.user.id : null,
        breakdown: {
          create: parsed.data.breakdown.map((b, i) => ({
            budgetItemId: b.budgetItemId,
            amount: b.amount,
            comment: b.comment || null,
            sortOrder: i,
          })),
        },
      },
    });
  });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cashPayment,
    entityId: paymentId,
    action: "UPDATE",
    summary: `Платёж ${parsed.data.amount}${lock ? " (зафиксирован)" : ""}`,
    changes: {
      budgetItemIds: [
        existing.breakdown.map((b) => b.budgetItemId),
        parsed.data.breakdown.map((b) => b.budgetItemId),
      ],
    },
  });

  revalidatePayments(projectId);
  return { success: "Сохранено" };
}

export async function deleteCashPaymentAction(
  projectId: string,
  paymentId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };

  const existing = await prisma.cashPayment.findFirst({
    where: { id: paymentId, projectId },
    select: { id: true, isLocked: true },
  });
  if (!existing) return { error: "Платёж не найден" };
  if (existing.isLocked) return { error: "Платёж зафиксирован — удалить нельзя" };

  await prisma.cashPayment.delete({ where: { id: paymentId } });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cashPayment,
    entityId: paymentId,
    action: "DELETE",
    summary: "Удалён платёж",
  });
  revalidatePayments(projectId);
  return {};
}

export async function setCashPaymentLockedAction(
  projectId: string,
  paymentId: string,
  locked: boolean,
): Promise<PaymentActionState> {
  const ctx = await requireProjectContext(projectId);

  const existing = await prisma.cashPayment.findFirst({
    where: { id: paymentId, projectId },
    select: { id: true, isLocked: true },
  });
  if (!existing) return { error: "Платёж не найден" };

  if (locked) {
    if (!ctx.can("finance:write")) return { error: "Недостаточно прав" };
    await prisma.cashPayment.update({
      where: { id: paymentId },
      data: {
        isLocked: true,
        lockedAt: new Date(),
        lockedById: ctx.user.id,
      },
    });
    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.cashPayment,
      entityId: paymentId,
      action: "UPDATE",
      summary: "Платёж зафиксирован",
    });
    revalidatePayments(projectId);
    return { success: "Платёж зафиксирован" };
  }

  if (!ctx.can("finance:unlock")) {
    return {
      error:
        "Недостаточно прав для снятия фиксации (нужно право в матрице ролей)",
    };
  }
  await prisma.cashPayment.update({
    where: { id: paymentId },
    data: {
      isLocked: false,
      lockedAt: null,
      lockedById: null,
    },
  });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cashPayment,
    entityId: paymentId,
    action: "UPDATE",
    summary: "Снята фиксация платежа",
  });
  revalidatePayments(projectId);
  return { success: "Фиксация снята" };
}
