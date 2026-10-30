/** Расчётные значения статьи для снимка: строка листа (с 0) и суммы, как в строке версии. */
export type FrozenRow = { row: number; amount: number; tax: number; total: number };

export type FrozenColumns = { amount?: number; tax?: number; total?: number };

type Cell = Record<string, unknown>;
type CellData = Record<string, Record<string, Cell | null | undefined> | undefined>;

/** Подытог вида «=СУММ(G3:G7)» / «=SUM(G3:G7)» по одной колонке. */
const SUBTOTAL = /^=\s*(?:SUM|СУММ)\(\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*\)\s*$/i;

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function setNumber(cells: CellData, row: number, col: number, value: number) {
  const line = (cells[row] ??= {});
  const cell = (line[col] ?? {}) as Cell;
  line[col] = { ...cell, v: value, t: 2 };
}

/**
 * Снимок основного листа для утверждённой версии: формулы заменены значениями.
 * В версии нет других листов книги, поэтому ссылки вроде `=Лист1!B2` сломались бы —
 * в снимке остаются только числа и тексты.
 *
 * Сумма, Налог и Итого строк-статей берутся из серверного расчёта (как в строках версии),
 * а не из того, что вписано в ячейку. Подытоги «СУММ по диапазону одной колонки»
 * пересчитываются по уже исправленным ячейкам. Остальные формулы — значение из листа.
 */
export function freezeSheetFormulas(
  sheet: Record<string, unknown>,
  columns: FrozenColumns = {},
  rows: readonly FrozenRow[] = [],
): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(sheet)) as Record<string, unknown>;
  if (!copy.cellData || typeof copy.cellData !== "object") return copy;
  const cells = copy.cellData as CellData;

  for (const r of rows) {
    if (columns.amount !== undefined) setNumber(cells, r.row, columns.amount, r.amount);
    if (columns.tax !== undefined) setNumber(cells, r.row, columns.tax, r.tax);
    if (columns.total !== undefined) setNumber(cells, r.row, columns.total, r.total);
  }

  const rowKeys = Object.keys(cells)
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  for (const row of rowKeys) {
    const line = cells[row];
    if (!line) continue;
    for (const [colKey, cell] of Object.entries(line)) {
      if (!cell || typeof cell !== "object") continue;
      const match = typeof cell.f === "string" ? SUBTOTAL.exec(cell.f) : null;
      if (match && match[1].toUpperCase() === match[3].toUpperCase()) {
        const col = columnIndex(match[1]);
        const from = Math.min(Number(match[2]), Number(match[4])) - 1;
        const to = Math.max(Number(match[2]), Number(match[4])) - 1;
        let sum = 0;
        for (let i = from; i <= to; i++) {
          const v = cells[i]?.[col]?.v;
          if (typeof v === "number" && Number.isFinite(v)) sum += v;
        }
        line[colKey] = { ...cell, v: round2(sum), t: 2 };
      }
    }
    for (const cell of Object.values(line)) {
      if (!cell || typeof cell !== "object") continue;
      delete cell.f;
      delete cell.si;
    }
  }
  return copy;
}
