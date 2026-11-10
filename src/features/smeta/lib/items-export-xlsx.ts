import ExcelJS from "exceljs";
import type { ExportColumn } from "@/features/exports/types";
import type { SmetaExportFieldId } from "@/features/smeta/lib/items-export-columns";

export {
  SMETA_EXPORT_FIELDS,
  smetaDefaultExportColumns,
  smetaExportColumns,
  type SmetaExportFieldId,
} from "@/features/smeta/lib/items-export-columns";
import { snapshotMultipliersText, type ItemsSnapshot, type SnapshotTotals } from "@/features/smeta/lib/items-snapshot";
import { excelSafe } from "@/shared/lib/excel-safe";

/**
 * Excel сметы цеха по статьям: статьи → подстатьи → строки с итогами уровней и колонкой «Код»
 * (по ней импорт обновляет строки, а не дублирует). Набор и порядок колонок — из конструктора
 * колонок; «Код» в нём можно убрать. Деньги — числами с копейками, без формул.
 */

const NUMERIC = new Set<string>(["quantity", "rate", "taxPercent", "amount", "tax", "total"]);
const MONEY_FIELDS = new Set<string>(["rate", "amount", "tax", "total"]);
const MONEY = "#,##0.00";
const PLAIN = "0.####";

/** Значения строки листа по полям: строки — текстом, числа — числами (null — пусто). */
type RowValues = Partial<Record<SmetaExportFieldId, string | number | null>>;

function num(value: string | null): number | null {
  return value == null ? null : Number(value);
}

function moneyValues(t: Pick<SnapshotTotals, "amount" | "tax" | "total">): RowValues {
  return { amount: num(t.amount), tax: num(t.tax), total: num(t.total) };
}

/** Одна колонка — одно поле: число остаётся числом; несколько полей — текст через « · ». */
function cellFor(column: ExportColumn, values: RowValues): ExcelJS.CellValue {
  if (column.fieldIds.length === 1) {
    const v = values[column.fieldIds[0] as SmetaExportFieldId];
    if (v == null || v === "") return null;
    return typeof v === "number" ? v : excelSafe(v);
  }
  const parts = column.fieldIds
    .map((f) => values[f as SmetaExportFieldId])
    .filter((v) => v != null && v !== "")
    .map((v) => (typeof v === "number" ? v.toLocaleString("ru-RU", { maximumFractionDigits: 4 }) : v));
  return parts.length > 0 ? excelSafe(parts.join(" · ")) : null;
}

function excelSheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Смета";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

const ARTICLE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EAEE" } };
const SUB_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F5F7" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };

function writeRow(
  sheet: ExcelJS.Worksheet,
  columns: ExportColumn[],
  values: RowValues,
  style: { bold?: boolean; fill?: ExcelJS.Fill; indent?: number } = {},
) {
  const row = sheet.addRow(columns.map((c) => cellFor(c, values)));
  columns.forEach((c, index) => {
    const cell = row.getCell(index + 1);
    if (c.fieldIds.length === 1 && NUMERIC.has(c.fieldIds[0])) {
      cell.numFmt = MONEY_FIELDS.has(c.fieldIds[0]) ? MONEY : PLAIN;
    }
    if (style.indent && c.fieldIds[0] === "name") cell.alignment = { indent: style.indent };
    if (style.bold) cell.font = { bold: true };
    if (style.fill) cell.fill = style.fill;
  });
  return row;
}

/** Лист сметы цеха из снимка: шапка, статьи, подстатьи, строки, итог. */
export function addItemsSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  snapshot: ItemsSnapshot,
  columns: ExportColumn[],
  taken: Set<string> = new Set(workbook.worksheets.map((s) => s.name.toLowerCase())),
) {
  const sheet = workbook.addWorksheet(excelSheetName(sheetName, taken));
  const header = sheet.addRow(columns.map((c) => excelSafe(c.title)));
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const article of snapshot.articles) {
    // Код статьи и подстатьи — из снимка; в старых снимках — по коду первой строки.
    const firstLine = article.subarticles.flatMap((s) => s.lines)[0];
    const articleCode = article.code ?? firstLine?.code.split(".")[0] ?? null;
    writeRow(sheet, columns, { code: articleCode, name: article.name, ...moneyValues(article.totals) }, { bold: true, fill: ARTICLE_FILL });
    for (const sub of article.subarticles) {
      const subCode = sub.code ?? (sub.lines[0] ? sub.lines[0].code.split(".").slice(0, 2).join(".") : null);
      writeRow(sheet, columns, { code: subCode, name: sub.name, ...moneyValues(sub.totals) }, { bold: true, fill: SUB_FILL, indent: 1 });
      for (const line of sub.lines) {
        writeRow(
          sheet,
          columns,
          {
            code: line.code,
            name: line.name,
            expenseType: line.expenseType,
            unit: line.unit,
            quantity: num(line.quantity),
            rate: num(line.rate),
            multipliers: snapshotMultipliersText(line.multipliers) || null,
            paymentForm: line.paymentForm,
            taxPercent: num(line.taxPercent),
            ...moneyValues({ amount: line.amount ?? "", tax: line.tax ?? "", total: line.total ?? "" }),
            ...(line.total == null ? { amount: null, tax: null, total: null } : {}),
          },
          { indent: 2 },
        );
      }
    }
  }
  writeRow(sheet, columns, { name: "Итого по смете", ...moneyValues(snapshot.totals) }, { bold: true, fill: ARTICLE_FILL });

  sheet.columns.forEach((col, index) => {
    const field = columns[index]?.fieldIds[0];
    col.width = field === "name" ? 44 : field === "multipliers" ? 28 : field === "code" ? 14 : 14;
  });
  return sheet;
}

/** Старая версия (табличный формат): плоский список строк с кодом и суммами. */
export function addSheetVersionLines(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  lines: { code: string; name: string; unit: string | null; quantity: number | null; rate: number | null; taxPercent: number | null; amount: number; tax: number; total: number }[],
  columns: ExportColumn[],
  taken: Set<string> = new Set(workbook.worksheets.map((s) => s.name.toLowerCase())),
) {
  const sheet = workbook.addWorksheet(excelSheetName(sheetName, taken));
  const header = sheet.addRow(columns.map((c) => excelSafe(c.title)));
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });
  for (const l of lines) writeRow(sheet, columns, { ...l });
  const total = (key: "amount" | "tax" | "total") => Math.round(lines.reduce((s, l) => s + l[key], 0) * 100) / 100;
  writeRow(sheet, columns, { name: "Итого по смете", amount: total("amount"), tax: total("tax"), total: total("total") }, { bold: true, fill: ARTICLE_FILL });
  return sheet;
}

export type SummarySheetRow = {
  name: string;
  note: string;
  amount: string;
  tax: string;
  total: string;
  /** Факт на дату выгрузки (с налогом). */
  accrued: number;
  paid: number;
};

/** Лист «Свод»: цеха с итогами, итог по цехам, резерв, агентские, итог по проекту. */
export function addSummarySheet(
  workbook: ExcelJS.Workbook,
  input: {
    rows: SummarySheetRow[];
    /** Начисления и платежи без статьи сметы. */
    unassigned: { accrued: number; paid: number } | null;
    subtotal: { amount: string; tax: string; total: string };
    reserve: { percent: string; amount: string };
    agency: { percent: string; amount: string };
    total: string;
  },
) {
  const sheet = workbook.addWorksheet("Свод");
  const header = sheet.addRow(["Цех", "Версия / статус", "Сумма", "Налог", "Итого", "Начислено", "Оплачено"]);
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });
  const money = (row: ExcelJS.Row) => [3, 4, 5, 6, 7].forEach((c) => (row.getCell(c).numFmt = MONEY));
  for (const r of input.rows) {
    money(sheet.addRow([excelSafe(r.name), excelSafe(r.note), Number(r.amount), Number(r.tax), Number(r.total), r.accrued, r.paid]));
  }
  if (input.unassigned) {
    money(sheet.addRow(["Без статьи", "начисления и платежи без статьи", null, null, null, input.unassigned.accrued, input.unassigned.paid]));
  }
  const bold = (row: ExcelJS.Row) => row.eachCell((cell) => (cell.font = { bold: true }));
  const round = (n: number) => Math.round(n * 100) / 100;
  const factTotal = (key: "accrued" | "paid") =>
    round(input.rows.reduce((s, r) => s + r[key], 0) + (input.unassigned?.[key] ?? 0));
  const sub = sheet.addRow([
    "Итого по цехам",
    "",
    Number(input.subtotal.amount),
    Number(input.subtotal.tax),
    Number(input.subtotal.total),
    factTotal("accrued"),
    factTotal("paid"),
  ]);
  money(sub);
  bold(sub);
  const pct = (p: string) => p.replace(".", ",");
  money(sheet.addRow([`Резерв, ${pct(input.reserve.percent)}%`, "от итога цехов с налогом", null, null, Number(input.reserve.amount)]));
  money(sheet.addRow([`Агентские, ${pct(input.agency.percent)}%`, "от итога цехов с налогом", null, null, Number(input.agency.amount)]));
  const total = sheet.addRow(["Итого по проекту", "", null, null, Number(input.total)]);
  money(total);
  bold(total);
  sheet.columns = [{ width: 36 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 16 }];
  sheet.addRow([]);
  sheet.addRow(["Суммы сметы — с налогом; факт (начислено / оплачено) — на дату выгрузки, за всё время."]);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return sheet;
}
