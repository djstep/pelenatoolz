import "server-only";

import type { Prisma } from "@prisma/client";
import type { Tx } from "@/features/smeta/queries";
import { shareTaxOverBreakdown } from "@/features/smeta/lib/payment-tax-share";

/** Клиент базы или транзакция — для чтения факта. */
export type FactDb = Pick<Tx, "accrual" | "cashPayment">;

export type FactSums = { accrued: number; paid: number };

export type FactScope = {
  /** Цеха, чьи статьи считать: "all" — все. */
  departments: "all" | readonly string[];
  /** Период по дате начисления / платежа (включительно). */
  dateRange?: { gte?: Date; lte?: Date };
  /** Считать ли начисления и строки платежей без статьи. */
  withUnassigned?: boolean;
};

/**
 * Факт по статьям смет, всё с налогом: начислено — `amountWithTax`, оплачено — строка
 * разбивки с её долей налога платежа (`shareTaxOverBreakdown`).
 */
export async function loadFacts(
  db: FactDb,
  projectId: string,
  scope: FactScope,
): Promise<{ byItem: Map<string, FactSums>; unassigned: FactSums }> {
  const departmentFilter: Prisma.BudgetItemWhereInput | undefined =
    scope.departments === "all" ? undefined : { departmentId: { in: [...scope.departments] } };
  const accrualItem: Prisma.AccrualWhereInput =
    scope.departments === "all"
      ? scope.withUnassigned
        ? {}
        : { budgetItemId: { not: null } }
      : scope.withUnassigned
        ? { OR: [{ budgetItem: departmentFilter }, { budgetItemId: null }] }
        : { budgetItem: departmentFilter };
  const breakdownItem: Prisma.CashPaymentBreakdownWhereInput =
    scope.departments === "all"
      ? scope.withUnassigned
        ? {}
        : { budgetItemId: { not: null } }
      : scope.withUnassigned
        ? { OR: [{ budgetItem: departmentFilter }, { budgetItemId: null }] }
        : { budgetItem: departmentFilter };

  const [accrued, payments] = await Promise.all([
    db.accrual.groupBy({
      by: ["budgetItemId"],
      where: { projectId, ...(scope.dateRange ? { date: scope.dateRange } : {}), ...accrualItem },
      _sum: { amountWithTax: true },
    }),
    // Платёж целиком (все строки): налог делится по всем строкам, потом берутся нужные.
    db.cashPayment.findMany({
      where: {
        projectId,
        ...(scope.dateRange ? { date: scope.dateRange } : {}),
        breakdown: { some: breakdownItem },
      },
      select: {
        amount: true,
        amountWithTax: true,
        breakdown: {
          select: {
            amount: true,
            budgetItemId: true,
            budgetItem: { select: { departmentId: true } },
          },
        },
      },
    }),
  ]);

  const byItem = new Map<string, FactSums>();
  const unassigned: FactSums = { accrued: 0, paid: 0 };
  const sumsOf = (itemId: string) => {
    let s = byItem.get(itemId);
    if (!s) byItem.set(itemId, (s = { accrued: 0, paid: 0 }));
    return s;
  };

  for (const a of accrued) {
    const value = Number(a._sum.amountWithTax ?? 0);
    if (a.budgetItemId) sumsOf(a.budgetItemId).accrued += value;
    else unassigned.accrued += value;
  }

  const inScope = (departmentId: string) =>
    scope.departments === "all" || scope.departments.includes(departmentId);
  for (const p of payments) {
    const shares = shareTaxOverBreakdown(
      { amount: Number(p.amount), amountWithTax: Number(p.amountWithTax) },
      p.breakdown.map((b) => ({ ...b, amount: Number(b.amount) })),
    );
    for (const { row, withTax } of shares) {
      if (row.budgetItemId && row.budgetItem) {
        if (inScope(row.budgetItem.departmentId)) sumsOf(row.budgetItemId).paid += withTax;
      } else if (scope.withUnassigned) {
        unassigned.paid += withTax;
      }
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  for (const s of byItem.values()) {
    s.accrued = round(s.accrued);
    s.paid = round(s.paid);
  }
  unassigned.accrued = round(unassigned.accrued);
  unassigned.paid = round(unassigned.paid);
  return { byItem, unassigned };
}
