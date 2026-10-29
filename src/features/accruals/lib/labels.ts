import { AccrualReportPart, AccrualType } from "@prisma/client";

export const accrualTypeLabels: Record<AccrualType, string> = {
  PER_SHIFT: "Посменное",
  ONE_TIME: "Разовое",
};

/** Часть оплаты строки отчёта смены, из которой создано начисление. */
export const accrualReportPartLabels: Record<AccrualReportPart, string> = {
  SHIFT: "смена",
  OVERTIME: "переработка",
  EXTRAS: "доплаты",
  MILEAGE: "км",
};

export function computeTaxAmounts(amount: number, taxPercent: number | null) {
  if (taxPercent == null || Number.isNaN(taxPercent)) {
    return { taxAmount: null as number | null, amountWithTax: amount };
  }
  const taxAmount = Math.round(amount * taxPercent) / 100;
  return {
    taxAmount,
    amountWithTax: Math.round((amount + taxAmount) * 100) / 100,
  };
}
