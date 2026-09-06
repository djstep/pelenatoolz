import { computeTaxAmounts } from "@/features/accruals/lib/labels";

export { computeTaxAmounts };

export function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

/** Breakdown amounts should sum to payment amount (tolerance 0.01). */
export function breakdownSumMatches(
  amount: number,
  parts: number[],
  epsilon = 0.01,
) {
  const sum = roundMoney(parts.reduce((s, p) => s + p, 0));
  return Math.abs(sum - roundMoney(amount)) <= epsilon;
}
