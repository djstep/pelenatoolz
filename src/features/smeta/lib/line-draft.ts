import { calcItem, type ItemCalc, type ItemMultiplier, type VariableValues } from "@/features/smeta/lib/item-calc";
import { parseDecimal } from "@/features/smeta/lib/item-input";

/**
 * Строка сметы в форме ввода на экране: то, что набрано в полях (строками), и предпросмотр
 * расчёта. Сервер считает и проверяет заново — экран только показывает.
 */

export type DraftSlot =
  | { kind: "none" }
  | { kind: "variable"; variableId: string }
  | { kind: "number"; value: string };

export type LineDraft = {
  name: string;
  unit: string;
  quantity: string;
  rate: string;
  slots: [DraftSlot, DraftSlot, DraftSlot];
  expenseTypeId: string;
  paymentFormId: string;
  taxPercent: string;
};

export type StoredLine = {
  name: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  multipliers: ({ variableId: string } | { value: string } | null)[];
  expenseTypeId: string | null;
  paymentFormId: string | null;
  taxPercent: string | null;
};

/** Число из базы — в поле ввода по-русски: запятая вместо точки. */
export function numberToInput(value: string | null): string {
  return value == null ? "" : value.replace(".", ",");
}

export function draftFromLine(line: StoredLine): LineDraft {
  const slot = (m: StoredLine["multipliers"][number] | undefined): DraftSlot =>
    m == null ? { kind: "none" } : "variableId" in m ? { kind: "variable", variableId: m.variableId } : { kind: "number", value: numberToInput(m.value) };
  return {
    name: line.name,
    unit: line.unit ?? "",
    quantity: numberToInput(line.quantity),
    rate: numberToInput(line.rate),
    slots: [slot(line.multipliers[0]), slot(line.multipliers[1]), slot(line.multipliers[2])],
    expenseTypeId: line.expenseTypeId ?? "",
    paymentFormId: line.paymentFormId ?? "",
    taxPercent: numberToInput(line.taxPercent),
  };
}

/** Данные для сервера (налог % — всегда явно: на экране он уже подставлен из формы оплаты). */
export function draftToPayload(d: LineDraft) {
  return {
    name: d.name,
    unit: d.unit,
    quantity: d.quantity,
    rate: d.rate,
    multipliers: d.slots.map((s) =>
      s.kind === "variable" ? { variableId: s.variableId } : s.kind === "number" ? (s.value.trim() ? { value: s.value } : null) : null,
    ),
    expenseTypeId: d.expenseTypeId || null,
    paymentFormId: d.paymentFormId || null,
    taxPercent: d.taxPercent,
  };
}

export function sameDraft(a: LineDraft, b: LineDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type DraftField = "quantity" | "rate" | "taxPercent" | "multipliers";

export type DraftPreview = ItemCalc & {
  /** Поля, где набрано не число (или вне границ): строка не сохранится, пока не исправить. */
  invalid: DraftField[];
};

/** Предпросмотр расчёта по набранному. Неверные поля помечаются, сумма тогда не считается. */
export function previewDraft(d: LineDraft, variables: VariableValues): DraftPreview {
  const invalid: DraftField[] = [];
  const quantity = parseDecimal(d.quantity, 4, 1_000_000_000_000);
  if (!quantity.ok) invalid.push("quantity");
  const rate = parseDecimal(d.rate, 2, 1_000_000_000_000);
  if (!rate.ok) invalid.push("rate");
  const tax = parseDecimal(d.taxPercent, 4, 100);
  if (!tax.ok) invalid.push("taxPercent");
  const multipliers: (ItemMultiplier | null)[] = [];
  for (const s of d.slots) {
    if (s.kind === "variable") multipliers.push({ variableId: s.variableId });
    else if (s.kind === "number" && s.value.trim()) {
      const v = parseDecimal(s.value, 4, 1_000_000_000);
      if (!v.ok) {
        if (!invalid.includes("multipliers")) invalid.push("multipliers");
      } else if (v.value != null) multipliers.push({ value: v.value });
    }
  }
  if (invalid.length > 0) return { amount: null, tax: null, total: null, problems: [], invalid };
  const calc = calcItem(
    {
      quantity: quantity.ok ? quantity.value : null,
      rate: rate.ok ? rate.value : null,
      multipliers,
      taxPercent: tax.ok ? tax.value : null,
    },
    variables,
  );
  return { ...calc, invalid };
}

const MONEY = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });

/** «1 234 567,89» — тысячи разделены, две цифры после запятой. */
export function formatMoney(value: string | { toString(): string } | null | undefined): string {
  if (value == null) return "";
  const n = Number(value.toString());
  return Number.isFinite(n) ? MONEY.format(n) : "";
}

/** Значение переменной или числа-множителя: «32», «0,7». */
export function formatNumber(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? NUMBER.format(n) : value;
}
