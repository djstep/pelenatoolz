import {
  formatMoney,
  withTax,
} from "@/features/reports/lib/compute-work-pay";

/** Gross (с налогом) → base (без налога) по ставке %. */
export function stripTax(
  gross: number | null | undefined,
  taxPercent: number | null | undefined,
): number | null {
  if (gross == null || Number.isNaN(Number(gross))) return null;
  const g = Number(gross);
  const pct = taxPercent != null ? Number(taxPercent) : 0;
  if (!Number.isFinite(pct) || pct <= 0) return g;
  return Math.round((g / (1 + pct / 100)) * 100) / 100;
}

export function pickTaxModeAmount(
  withTaxAmount: number | null | undefined,
  withoutTaxAmount: number | null | undefined,
  showWithTax: boolean,
): number | null {
  return showWithTax
    ? withTaxAmount != null
      ? Number(withTaxAmount)
      : null
    : withoutTaxAmount != null
      ? Number(withoutTaxAmount)
      : null;
}

export function formatPay(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return `${formatMoney(amount)} ₽`;
}

export { withTax, formatMoney };
