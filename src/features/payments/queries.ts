import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export type CashPaymentFilters = {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  budgetLineId?: string;
  counterpartyId?: string;
  companyId?: string;
  locked?: "yes" | "no";
};

const paymentInclude = {
  counterparty: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  lockedBy: { select: { id: true, name: true } },
  breakdown: {
    include: {
      budgetLine: { select: { id: true, title: true } },
    },
    orderBy: { sortOrder: "asc" as const },
  },
} as const;

export async function listCashPayments(
  projectId: string,
  filters: CashPaymentFilters = {},
) {
  const where: Prisma.CashPaymentWhereInput = { projectId };

  if (filters.dateFrom || filters.dateTo) {
    where.date = {};
    if (filters.dateFrom) {
      where.date.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    }
    if (filters.dateTo) {
      where.date.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
    }
  }
  if (filters.counterpartyId) where.counterpartyId = filters.counterpartyId;
  if (filters.companyId) where.companyId = filters.companyId;
  if (filters.locked === "yes") where.isLocked = true;
  if (filters.locked === "no") where.isLocked = false;
  if (filters.budgetLineId) {
    where.breakdown = { some: { budgetLineId: filters.budgetLineId } };
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { comment: { contains: q, mode: "insensitive" } },
      { counterparty: { name: { contains: q, mode: "insensitive" } } },
      { company: { name: { contains: q, mode: "insensitive" } } },
      {
        breakdown: {
          some: {
            OR: [
              { comment: { contains: q, mode: "insensitive" } },
              { budgetLine: { title: { contains: q, mode: "insensitive" } } },
            ],
          },
        },
      },
    ];
  }

  const rows = await prisma.cashPayment.findMany({
    where,
    include: paymentInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return serializeForClient(rows) as typeof rows;
}

export async function getCashPaymentTotals(
  projectId: string,
  filters: CashPaymentFilters = {},
) {
  const rows = await listCashPayments(projectId, filters);
  let amount = 0;
  let withTax = 0;
  for (const r of rows) {
    amount += Number(r.amount);
    withTax += Number(r.amountWithTax);
  }
  return { count: rows.length, amount, withTax };
}

export async function getCashPayment(projectId: string, paymentId: string) {
  const row = await prisma.cashPayment.findFirst({
    where: { id: paymentId, projectId },
    include: paymentInclude,
  });
  return row ? (serializeForClient(row) as typeof row) : null;
}

export type CashPaymentListRow = Awaited<
  ReturnType<typeof listCashPayments>
>[number];
