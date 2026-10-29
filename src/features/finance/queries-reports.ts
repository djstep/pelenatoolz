import { Prisma } from "@prisma/client";
import { describeBudgetItems } from "@/features/smeta/budget-item-access";
import { budgetItemLabel } from "@/features/smeta/lib/budget-item-option";
import type { SmetaAccessContext } from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export type ReportDateFilters = {
  dateFrom?: string;
  dateTo?: string;
};

function dateRange(filters: ReportDateFilters): Prisma.DateTimeFilter | undefined {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (filters.dateFrom) range.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) range.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
  return range;
}

export type CashFlowFilters = ReportDateFilters & {
  companyId?: string;
  counterpartyId?: string;
};

export type CashFlowRow = {
  id: string;
  date: string;
  companyId: string;
  companyName: string;
  counterpartyId: string;
  counterpartyName: string;
  amount: number;
  taxAmount: number;
  amountWithTax: number;
  comment: string | null;
  isLocked: boolean;
  breakdown: { title: string; amount: number }[];
};

export type CashFlowReport = {
  rows: CashFlowRow[];
  totals: { amount: number; taxAmount: number; amountWithTax: number; count: number };
};

/**
 * Движение денег — кассовые платежи за период. Статьи разбивки подписаны кодом и
 * наименованием, если пользователь видит смету цеха (иначе «Статья другого цеха»).
 */
export async function getCashFlowReport(
  projectId: string,
  access: SmetaAccessContext,
  filters: CashFlowFilters = {},
): Promise<CashFlowReport> {
  const range = dateRange(filters);

  const payments = await prisma.cashPayment.findMany({
    where: {
      projectId,
      ...(range ? { date: range } : {}),
      ...(filters.companyId ? { companyId: filters.companyId } : {}),
      ...(filters.counterpartyId
        ? { counterpartyId: filters.counterpartyId }
        : {}),
    },
    include: {
      company: { select: { id: true, name: true } },
      counterparty: { select: { id: true, name: true } },
      breakdown: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const items = await describeBudgetItems(
    projectId,
    access,
    payments.flatMap((p) => p.breakdown.map((b) => b.budgetItemId)),
  );

  const rows: CashFlowRow[] = payments.map((p) => ({
    id: p.id,
    date: p.date.toISOString(),
    companyId: p.companyId,
    companyName: p.company.name,
    counterpartyId: p.counterpartyId,
    counterpartyName: p.counterparty.name,
    amount: Number(p.amount),
    taxAmount: Number(p.taxAmount ?? 0),
    amountWithTax: Number(p.amountWithTax),
    comment: p.comment,
    isLocked: p.isLocked,
    breakdown: p.breakdown.map((b) => ({
      title: budgetItemLabel(b.budgetItemId ? items[b.budgetItemId] : null),
      amount: Number(b.amount),
    })),
  }));

  const totals = rows.reduce(
    (acc, r) => {
      acc.amount += r.amount;
      acc.taxAmount += r.taxAmount;
      acc.amountWithTax += r.amountWithTax;
      acc.count += 1;
      return acc;
    },
    { amount: 0, taxAmount: 0, amountWithTax: 0, count: 0 },
  );

  return serializeForClient({ rows, totals }) as CashFlowReport;
}
