export const DEFAULT_LEDGER_TYPES = [
  { name: "Актёры", sortOrder: 10 },
  { name: "Группа", sortOrder: 20 },
  { name: "Оборудование", sortOrder: 30 },
  { name: "Транспорт", sortOrder: 40 },
] as const;

/** Поле «Ставка налога, %» в форме: сохранённая ставка или пусто (ставка по умолчанию не подставляется). */
export function vatRateInput(rate?: number | null) {
  return rate == null ? "" : String(rate);
}

/**
 * Поле «Налог вручную» при правке: сохранённая сумма налога, если она введена суммой,
 * а не посчитана по ставке (ставки нет или сумма с ней не сходится). Иначе пусто.
 */
export function vatManualInput(
  saved?: {
    amount?: number;
    vatEnabled?: boolean;
    vatRate?: number | null;
    vatAmount?: number | null;
  } | null,
) {
  if (!saved?.vatEnabled || saved.vatAmount == null) return "";
  if (
    saved.vatRate != null &&
    round2(((saved.amount ?? 0) * saved.vatRate) / 100) === round2(saved.vatAmount)
  ) {
    return "";
  }
  return String(saved.vatAmount);
}

/**
 * Налог договора или акта (поля в базе по-прежнему называются vat*). Налог включён,
 * но ни ставка, ни сумма не заданы — налога нет (пусто), ставка по умолчанию не берётся.
 */
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
  if (input.vatRate == null || !Number.isFinite(input.vatRate)) {
    return { vatAmount: null, amountWithVat: round2(amount) };
  }
  const vatAmount = round2((amount * input.vatRate) / 100);
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
