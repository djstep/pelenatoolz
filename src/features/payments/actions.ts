"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  breakdownSumMatches,
  computeTaxAmounts,
} from "@/features/payments/lib/calc";
import { requireProjectContext } from "@/features/projects/lib/project-context";
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
  budgetLineId: z.string().cuid(),
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

function parseBreakdown(formData: FormData) {
  const raw = String(formData.get("breakdownJson") ?? "[]");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function validatePaymentRefs(
  projectId: string,
  data: z.infer<typeof paymentSchema>,
) {
  const [cp, company] = await Promise.all([
    prisma.counterparty.findFirst({
      where: { id: data.counterpartyId, projectId },
      select: { id: true },
    }),
    prisma.company.findFirst({
      where: { id: data.companyId, projectId },
      select: { id: true },
    }),
  ]);
  if (!cp) return "Контрагент не найден";
  if (!company) return "Компания не найдена";

  const lineIds = [...new Set(data.breakdown.map((b) => b.budgetLineId))];
  const lines = await prisma.budgetLine.findMany({
    where: { projectId, id: { in: lineIds } },
    select: { id: true },
  });
  if (lines.length !== lineIds.length) return "Статья сметы не найдена";

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
  if (!parsed.success) return { error: "Проверьте данные платежа" };

  const err = await validatePaymentRefs(projectId, parsed.data);
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
          budgetLineId: b.budgetLineId,
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
  if (!parsed.success) return { error: "Проверьте данные платежа" };

  const err = await validatePaymentRefs(projectId, parsed.data);
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
            budgetLineId: b.budgetLineId,
            amount: b.amount,
            comment: b.comment || null,
            sortOrder: i,
          })),
        },
      },
    });
  });

  revalidatePayments(projectId);
  return { success: "Сохранено" };
}

export async function deleteCashPaymentAction(
  projectId: string,
  paymentId: string,
) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:write")) throw new Error("FORBIDDEN");

  const existing = await prisma.cashPayment.findFirst({
    where: { id: paymentId, projectId },
    select: { id: true, isLocked: true },
  });
  if (!existing) throw new Error("NOT_FOUND");
  if (existing.isLocked) throw new Error("LOCKED");

  await prisma.cashPayment.delete({ where: { id: paymentId } });
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.cashPayment,
    entityId: paymentId,
    action: "DELETE",
    summary: "Удалён платёж",
  });
  revalidatePayments(projectId);
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
