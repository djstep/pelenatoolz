import { BudgetCategory, Prisma } from "@prisma/client";
import { budgetCategoryLabels } from "@/features/budget/labels";
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

export type PlanFactRow = {
  budgetLineId: string;
  category: BudgetCategory;
  categoryLabel: string;
  title: string;
  planned: number;
  accrued: number;
  paid: number;
  /** план − начисления */
  variancePlan: number;
  /** начисления − оплачено */
  unpaid: number;
};

export type PlanFactReport = {
  rows: PlanFactRow[];
  totals: {
    planned: number;
    accrued: number;
    paid: number;
    variancePlan: number;
    unpaid: number;
  };
};

/** План (статья) vs начисления vs оплаченное по разбивке платежей. */
export async function getPlanFactReport(
  projectId: string,
  filters: ReportDateFilters = {},
): Promise<PlanFactReport> {
  const range = dateRange(filters);

  const [lines, accruals, paidGroups] = await Promise.all([
    prisma.budgetLine.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        category: true,
        planned: true,
        sortOrder: true,
      },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
    }),
    prisma.accrual.groupBy({
      by: ["budgetLineId"],
      where: {
        projectId,
        ...(range ? { date: range } : {}),
      },
      _sum: { amount: true, amountWithTax: true },
    }),
    prisma.cashPaymentBreakdown.groupBy({
      by: ["budgetLineId"],
      where: {
        payment: {
          projectId,
          ...(range ? { date: range } : {}),
        },
      },
      _sum: { amount: true },
    }),
  ]);

  const accruedMap = new Map(
    accruals.map((a) => [a.budgetLineId, Number(a._sum.amount ?? 0)]),
  );
  const paidMap = new Map(
    paidGroups.map((p) => [p.budgetLineId, Number(p._sum.amount ?? 0)]),
  );

  const rows: PlanFactRow[] = lines.map((line) => {
    const planned = Number(line.planned);
    const accrued = accruedMap.get(line.id) ?? 0;
    const paid = paidMap.get(line.id) ?? 0;
    return {
      budgetLineId: line.id,
      category: line.category,
      categoryLabel: budgetCategoryLabels[line.category],
      title: line.title,
      planned,
      accrued,
      paid,
      variancePlan: planned - accrued,
      unpaid: accrued - paid,
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.planned += r.planned;
      acc.accrued += r.accrued;
      acc.paid += r.paid;
      acc.variancePlan += r.variancePlan;
      acc.unpaid += r.unpaid;
      return acc;
    },
    { planned: 0, accrued: 0, paid: 0, variancePlan: 0, unpaid: 0 },
  );

  return serializeForClient({ rows, totals }) as PlanFactReport;
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

/** Движение денег — кассовые платежи за период. */
export async function getCashFlowReport(
  projectId: string,
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
      breakdown: {
        include: { budgetLine: { select: { title: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

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
      title: b.budgetLine.title,
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
