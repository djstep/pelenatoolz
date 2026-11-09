import { Prisma } from "@prisma/client";

/**
 * Расчёт строки сметы по статьям и итогов уровней. Деньги — Decimal, округление до копеек
 * на уровне строки (половина — вверх), итоги — сумма округлённых строк.
 *
 * Строка: Сумма = Кол-во × Ставка × множители; Налог = Сумма × Налог % / 100; Итого = Сумма + Налог.
 * Не заполнены количество или ставка, или пуста переменная-множитель — у строки нет суммы
 * (null) и есть пометка, почему; в итоги такая строка не входит (не ноль молча).
 */

/** Промежуточные произведения — с запасом точности (40 знаков), округление — только в конце строки. */
const D = Prisma.Decimal.clone({ precision: 40 });
type Decimal = Prisma.Decimal;

/** Наибольшая сумма строки: столбцы денег в базе — Decimal(18, 2). */
export const MAX_LINE_MONEY = new D("9999999999999999.99");
type DecimalLike = Prisma.Decimal | number | string;

/** Множитель строки: переменная проекта или своё число. Пустой слот — null. */
export type ItemMultiplier = { variableId: string } | { value: DecimalLike };

export type ItemCalcInput = {
  quantity: DecimalLike | null;
  rate: DecimalLike | null;
  multipliers: readonly (ItemMultiplier | null)[];
  taxPercent: DecimalLike | null;
};

/** Значение переменной по id: число или null (не задано). */
export type VariableValues = ReadonlyMap<string, DecimalLike | null>;

export type ItemProblem =
  | { kind: "no_quantity" }
  | { kind: "no_rate" }
  /** Переменная-множитель пуста (или удалена) — сумму не посчитать. */
  | { kind: "variable_missing"; variableId: string };

export type ItemCalc = {
  amount: Decimal | null;
  tax: Decimal | null;
  total: Decimal | null;
  problems: ItemProblem[];
};

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/** Посчитать одну строку. */
export function calcItem(input: ItemCalcInput, variables: VariableValues): ItemCalc {
  const problems: ItemProblem[] = [];
  if (input.quantity == null) problems.push({ kind: "no_quantity" });
  if (input.rate == null) problems.push({ kind: "no_rate" });

  let product = new D(1);
  for (const m of input.multipliers) {
    if (m == null) continue;
    if ("variableId" in m) {
      const value = variables.get(m.variableId);
      if (value == null) {
        problems.push({ kind: "variable_missing", variableId: m.variableId });
        continue;
      }
      product = product.mul(value);
    } else {
      product = product.mul(m.value);
    }
  }
  if (problems.length > 0) return { amount: null, tax: null, total: null, problems };

  const amount = money(new D(input.quantity!).mul(input.rate!).mul(product));
  const tax = money(amount.mul(input.taxPercent ?? 0).div(100));
  return { amount, tax, total: amount.plus(tax), problems };
}

export type Totals = {
  amount: Decimal;
  tax: Decimal;
  total: Decimal;
  /** Строк без суммы (не заполнены или пуста переменная): в итог не вошли. */
  incomplete: number;
};

export function emptyTotals(): Totals {
  return { amount: new D(0), tax: new D(0), total: new D(0), incomplete: 0 };
}

/** Итог по строкам: сумма уже округлённых строк; строки без суммы считаются отдельно. */
export function sumCalcs(calcs: readonly ItemCalc[]): Totals {
  const t = emptyTotals();
  for (const c of calcs) {
    if (c.amount == null || c.tax == null || c.total == null) {
      t.incomplete += 1;
      continue;
    }
    t.amount = t.amount.plus(c.amount);
    t.tax = t.tax.plus(c.tax);
    t.total = t.total.plus(c.total);
  }
  return t;
}

/** Итог по итогам уровней ниже. */
export function sumTotals(list: readonly Totals[]): Totals {
  const t = emptyTotals();
  for (const x of list) {
    t.amount = t.amount.plus(x.amount);
    t.tax = t.tax.plus(x.tax);
    t.total = t.total.plus(x.total);
    t.incomplete += x.incomplete;
  }
  return t;
}

/** Множители строки из колонок базы (три пары «переменная или число»). */
export function multipliersOf(row: {
  multiplier1VariableId: string | null;
  multiplier1Value: DecimalLike | null;
  multiplier2VariableId: string | null;
  multiplier2Value: DecimalLike | null;
  multiplier3VariableId: string | null;
  multiplier3Value: DecimalLike | null;
}): (ItemMultiplier | null)[] {
  const slot = (variableId: string | null, value: DecimalLike | null): ItemMultiplier | null =>
    variableId ? { variableId } : value != null ? { value } : null;
  return [
    slot(row.multiplier1VariableId, row.multiplier1Value),
    slot(row.multiplier2VariableId, row.multiplier2Value),
    slot(row.multiplier3VariableId, row.multiplier3Value),
  ];
}
