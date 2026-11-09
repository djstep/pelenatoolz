/**
 * Налог по умолчанию в новом договоре и акте: тип контрагента → форма оплаты → её процент.
 * - `unmapped` — тип не сопоставлен: налог выключен, поля пустые;
 * - `rate: null` — форма сопоставлена, но процента у неё нет: налог включён, ставку вводят руками
 *   (пустой налог при включённом налоге форма не сохранит);
 * - `rate: число` — налог включён с этой ставкой.
 */
export type CounterpartyTaxDefault = { mapped: false } | { mapped: true; rate: number | null };

/** Поля формы договора или акта для налога по умолчанию. */
export function taxDefaultFields(value: CounterpartyTaxDefault): {
  vatEnabled: boolean;
  vatRate: string;
  vatManual: string;
} {
  if (!value.mapped) return { vatEnabled: false, vatRate: "", vatManual: "" };
  return {
    vatEnabled: true,
    vatRate: value.rate == null ? "" : String(value.rate),
    vatManual: "",
  };
}
