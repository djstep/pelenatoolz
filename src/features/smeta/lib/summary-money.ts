import { Prisma } from "@prisma/client";

/** Деньги уровня сводной: строками, до копеек. */
export type SummaryMoney = { amount: string; tax: string; total: string };

const D = Prisma.Decimal;

/** Сумма уровней — сумма уже округлённых итогов (Decimal, без потерь). */
export function addMoney(list: readonly SummaryMoney[]): SummaryMoney {
  let amount = new D(0);
  let tax = new D(0);
  let total = new D(0);
  for (const m of list) {
    amount = amount.plus(m.amount);
    tax = tax.plus(m.tax);
    total = total.plus(m.total);
  }
  return { amount: amount.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) };
}

/** Процент от суммы с налогом, до копеек (половина — вверх): резерв и агентские. */
export function percentOf(base: string, percent: string): string {
  return new D(base).times(percent).dividedBy(100).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}
