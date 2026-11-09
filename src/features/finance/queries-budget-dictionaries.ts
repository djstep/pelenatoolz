import "server-only";

import type { CounterpartyType } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

export type ExpenseTypeRow = {
  id: string;
  name: string;
  isSystem: boolean;
  archived: boolean;
};

export type PaymentFormRow = {
  id: string;
  name: string;
  /** Пусто — процента по умолчанию нет, налог вводится руками. */
  defaultTaxPercent: number | null;
  isSystem: boolean;
  archived: boolean;
};

export type BudgetPercents = {
  reservePercent: number;
  agencyPercent: number;
};

/** Типы расходов проекта: действующие по порядку, затем архив. */
export async function listExpenseTypes(projectId: string): Promise<ExpenseTypeRow[]> {
  const rows = await prisma.projectExpenseType.findMany({
    where: { projectId },
    orderBy: [{ archivedAt: { sort: "desc", nulls: "first" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, isSystem: true, archivedAt: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, isSystem: r.isSystem, archived: r.archivedAt !== null }));
}

/** Формы оплаты проекта с процентом налога по умолчанию: действующие, затем архив. */
export async function listPaymentForms(projectId: string): Promise<PaymentFormRow[]> {
  const rows = await prisma.projectPaymentForm.findMany({
    where: { projectId },
    orderBy: [{ archivedAt: { sort: "desc", nulls: "first" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, defaultTaxPercent: true, isSystem: true, archivedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    defaultTaxPercent: r.defaultTaxPercent == null ? null : Number(r.defaultTaxPercent),
    isSystem: r.isSystem,
    archived: r.archivedAt !== null,
  }));
}

/** Тип контрагента → id формы оплаты. Нет ключа — не сопоставлено. */
export async function listCounterpartyPaymentForms(
  projectId: string,
): Promise<Partial<Record<CounterpartyType, string>>> {
  const rows = await prisma.projectCounterpartyPaymentForm.findMany({
    where: { projectId },
    select: { counterpartyType: true, paymentFormId: true },
  });
  return Object.fromEntries(rows.map((r) => [r.counterpartyType, r.paymentFormId]));
}

/** Резерв и агентские сводной. Нет записи настроек — 0 %. */
export async function getBudgetPercents(projectId: string): Promise<BudgetPercents> {
  const row = await prisma.projectBudgetSettings.findUnique({
    where: { projectId },
    select: { reservePercent: true, agencyPercent: true },
  });
  return {
    reservePercent: row ? Number(row.reservePercent) : 0,
    agencyPercent: row ? Number(row.agencyPercent) : 0,
  };
}
