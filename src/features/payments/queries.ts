import { Prisma } from "@prisma/client";
import type { VisibleDepartments } from "@/features/accruals/queries";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export type CashPaymentFilters = {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  /** id статьи или "none" — есть строка разбивки без статьи */
  budgetItemId?: string;
  counterpartyId?: string;
  companyId?: string;
  locked?: "yes" | "no";
};

const paymentInclude = {
  counterparty: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  contract: { select: { id: true, number: true } },
  createdBy: { select: { id: true, name: true } },
  lockedBy: { select: { id: true, name: true } },
  breakdown: {
    orderBy: { sortOrder: "asc" as const },
  },
} as const;

export async function listCashPayments(
  projectId: string,
  visible: VisibleDepartments,
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
  if (filters.budgetItemId === "none") {
    where.breakdown = { some: { budgetItemId: null } };
  } else if (filters.budgetItemId) {
    where.breakdown = { some: { budgetItemId: filters.budgetItemId } };
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    // По коду и наименованию ищем только среди статей смет, которые пользователь видит.
    const itemMatch: Prisma.BudgetItemWhereInput = {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
      ...(visible === "all" ? {} : { departmentId: { in: [...visible] } }),
    };
    where.OR = [
      { comment: { contains: q, mode: "insensitive" } },
      { counterparty: { name: { contains: q, mode: "insensitive" } } },
      { company: { name: { contains: q, mode: "insensitive" } } },
      {
        breakdown: {
          some: {
            OR: [
              { comment: { contains: q, mode: "insensitive" } },
              { budgetItem: itemMatch },
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

export function cashPaymentTotals(
  rows: { amount: unknown; amountWithTax: unknown }[],
) {
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
