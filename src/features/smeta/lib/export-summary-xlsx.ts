import ExcelJS from "exceljs";
import type { UniverWorkbookData } from "@/features/smeta/lib/workbook-model";
import { excelSafe } from "@/shared/lib/excel-safe";

/** Метка ячейки (`custom`): на экране что-то показано (прочерк), в Excel — пусто. */
export const EXCEL_EMPTY = "smetaExcelEmpty";

type Cell = Record<string, unknown>;
type CellData = Record<string, Record<string, Cell | null | undefined> | undefined>;
type Style = { bl?: unknown; n?: { pattern?: unknown } };
type Merge = { startRow: number; endRow: number; startColumn: number; endColumn: number };

/** Текст ячейки с форматированием Univer (`p`) — без разметки. */
function richText(p: unknown): string | null {
  const stream = (p as { body?: { dataStream?: unknown } } | null)?.body?.dataStream;
  return typeof stream === "string" ? stream.replace(/\r?\n$/, "").replace(/\r/g, "\n") : null;
}

/** Значение ячейки: сохранённое (у формул — вычисленное в книге), сами формулы не выгружаются. */
function cellValue(cell: Cell): ExcelJS.CellValue {
  if ((cell.custom as Record<string, unknown> | undefined)?.[EXCEL_EMPTY]) return null;
  const v = cell.v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "") return null;
    // t = 2 — число, сохранённое строкой.
    if (cell.t === 2 && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return excelSafe(v);
  }
  const text = richText(cell.p);
  return text ? excelSafe(text) : null;
}

/**
 * Сводная книга в Excel: те же листы, что на экране — значения и объединения ячеек, ширина
 * колонок, жирный шрифт и формат чисел из стиля. Без цветов и рамок.
 */
export function buildSummaryWorkbook(book: UniverWorkbookData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  const styles = (book.styles ?? {}) as Record<string, Style | null | undefined>;
  const styleOf = (s: unknown): Style | null =>
    typeof s === "string" ? (styles[s] ?? null) : s && typeof s === "object" ? (s as Style) : null;

  for (const sheetId of book.sheetOrder) {
    const src = book.sheets[sheetId];
    if (!src) continue;
    const sheet = workbook.addWorksheet(String(src.name ?? sheetId).slice(0, 31));

    const cells = (src.cellData ?? {}) as CellData;
    for (const [rowKey, line] of Object.entries(cells)) {
      const r = Number(rowKey);
      if (!Number.isInteger(r) || !line) continue;
      for (const [colKey, cell] of Object.entries(line)) {
        const c = Number(colKey);
        if (!Number.isInteger(c) || !cell || typeof cell !== "object") continue;
        const value = cellValue(cell);
        const style = styleOf(cell.s);
        if (value === null && !style) continue;
        const target = sheet.getCell(r + 1, c + 1);
        target.value = value;
        if (style?.bl) target.font = { bold: true };
        if (typeof style?.n?.pattern === "string" && typeof value === "number") {
          target.numFmt = style.n.pattern;
        }
      }
    }

    for (const m of (Array.isArray(src.mergeData) ? src.mergeData : []) as Merge[]) {
      if (![m.startRow, m.endRow, m.startColumn, m.endColumn].every(Number.isInteger)) continue;
      if (m.startRow === m.endRow && m.startColumn === m.endColumn) continue;
      try {
        sheet.mergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1);
      } catch {
        /* пересекающиеся объединения — оставляем ячейки как есть */
      }
    }

    const columns = (src.columnData ?? {}) as Record<string, { w?: unknown } | undefined>;
    for (const [colKey, col] of Object.entries(columns)) {
      const c = Number(colKey);
      if (Number.isInteger(c) && typeof col?.w === "number") {
        sheet.getColumn(c + 1).width = Math.max(4, Math.round(col.w / 7));
      }
    }

    const freeze = src.freeze as { ySplit?: unknown; xSplit?: unknown } | undefined;
    const ySplit = typeof freeze?.ySplit === "number" ? freeze.ySplit : 0;
    const xSplit = typeof freeze?.xSplit === "number" ? freeze.xSplit : 0;
    if (ySplit > 0 || xSplit > 0) sheet.views = [{ state: "frozen", ySplit, xSplit }];
  }
  return workbook;
}
