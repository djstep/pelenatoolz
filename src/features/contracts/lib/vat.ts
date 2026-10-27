export const DEFAULT_LEDGER_TYPES = [
  { name: "Актёры", sortOrder: 10 },
  { name: "Группа", sortOrder: 20 },
  { name: "Оборудование", sortOrder: 30 },
  { name: "Транспорт", sortOrder: 40 },
] as const;

export const VAT_RATE_PRESETS = [5, 7, 22] as const;

/** Значение списка ставок: вариант из списка или «custom», если сохранённой ставки среди вариантов нет. */
export function vatRateChoice(rate?: number | null) {
  const value = rate ?? 22;
  return (VAT_RATE_PRESETS as readonly number[]).includes(value)
    ? String(value)
    : "custom";
}

/** Своя ставка для поля «Другая…» (пусто, если ставка из списка). */
export function vatRateCustom(rate?: number | null) {
  return vatRateChoice(rate) === "custom" ? String(rate) : "";
}

export function computeContractVat(input: {
  amount: number;
  vatEnabled: boolean;
  vatRate?: number | null;
  vatAmountManual?: number | null;
}): { vatAmount: number | null; amountWithVat: number } {
  const amount = Number.isFinite(input.amount) ? input.amount : 0;
  if (!input.vatEnabled) {
    return { vatAmount: null, amountWithVat: round2(amount) };
  }
  if (
    input.vatAmountManual != null &&
    Number.isFinite(input.vatAmountManual)
  ) {
    const vatAmount = round2(input.vatAmountManual);
    return { vatAmount, amountWithVat: round2(amount + vatAmount) };
  }
  const rate = input.vatRate ?? 22;
  const vatAmount = round2((amount * rate) / 100);
  return { vatAmount, amountWithVat: round2(amount + vatAmount) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 40);
}
