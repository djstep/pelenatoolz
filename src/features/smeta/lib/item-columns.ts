/**
 * Колонки таблицы сметы цеха: порядок, ширины, видимые по умолчанию, разбор выбора из памяти
 * браузера. «Наименование» и кнопки строки — всегда, вне этого списка.
 */

export type ColumnKey =
  | "type"
  | "unit"
  | "quantity"
  | "rate"
  | "multipliers"
  | "paymentForm"
  | "taxPercent"
  | "amount"
  | "tax"
  | "total";

export type ColumnDef = { key: ColumnKey; label: string; width: number; right?: boolean; money?: boolean };

/** Порядок колонок после «Наименования». Ширины подобраны так, чтобы колонки по умолчанию помещались в 1280 px. */
export const COLUMNS: readonly ColumnDef[] = [
  { key: "type", label: "Тип", width: 128 },
  { key: "unit", label: "Ед.", width: 84 },
  { key: "quantity", label: "Кол-во", width: 84, right: true },
  { key: "rate", label: "Ставка", width: 112, right: true },
  { key: "multipliers", label: "Множители", width: 176 },
  { key: "paymentForm", label: "Форма оплаты", width: 128 },
  { key: "taxPercent", label: "Налог, %", width: 76, right: true },
  { key: "amount", label: "Сумма", width: 116, right: true, money: true },
  { key: "tax", label: "Налог", width: 104, right: true, money: true },
  { key: "total", label: "Итого", width: 124, right: true, money: true },
];
/** Видны по умолчанию (кроме «Наименования» и «Итого» — они всегда). */
export const DEFAULT_COLUMNS: readonly ColumnKey[] = ["quantity", "rate", "multipliers", "total"];
export const ALWAYS_COLUMNS: readonly ColumnKey[] = ["total"];
export const COLUMNS_KEY = "smeta-items-columns";
export const NAME_MIN_WIDTH = 240;
export const ACTIONS_WIDTH = 112;

/** Видимые колонки из памяти браузера: «quantity,rate,…»; неизвестные ключи пропускаются. */
export function parseVisibleColumns(raw: string | null): Set<ColumnKey> {
  const known = new Set<string>(COLUMNS.map((c) => c.key));
  const keys = raw == null ? DEFAULT_COLUMNS : (raw.split(",").filter((k) => known.has(k)) as ColumnKey[]);
  return new Set<ColumnKey>([...keys, ...ALWAYS_COLUMNS]);
}

export type ColumnsLayout = {
  /** Видимые колонки после «Наименования», без денег. */
  middle: ColumnDef[];
  /** Видимые колонки с деньгами. */
  money: ColumnDef[];
  /** Скрытые колонки: при правке строки они — в строке под ней. */
  hidden: ColumnDef[];
  /** Всего колонок в таблице (с «Наименованием» и кнопками). */
  count: number;
};

export function layoutOf(visible: Set<ColumnKey>): ColumnsLayout {
  const shown = COLUMNS.filter((c) => visible.has(c.key));
  const middle = shown.filter((c) => !c.money);
  const money = shown.filter((c) => c.money);
  return { middle, money, hidden: COLUMNS.filter((c) => !visible.has(c.key)), count: shown.length + 2 };
}

