import ExcelJS from "exceljs";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import {
  calendarExportCell,
  sortCalendarItems,
} from "@/features/prep-calendar/lib/calendar-export";
import type { CalendarItem } from "@/features/prep-calendar/lib/calendar-types";
import { excelSafe } from "@/shared/lib/excel-safe";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const COLUMN_WIDTH = 18;
const WIDE_COLUMN_WIDTH = 36;
const WIDE_FIELDS = new Set(["title", "people", "note", "place"]);

/** Лист Excel: плоская таблица по порядку событий, дата — обычная колонка (сортировка, фильтры). */
export async function buildCalendarWorkbook(
  columns: ExportColumn[],
  items: CalendarItem[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Календарь", { views: [{ state: "frozen", ySplit: 1 }] });

  const header = sheet.addRow(columns.map((column) => excelSafe(resolveColumnHeader(column))));
  header.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  for (const item of sortCalendarItems(items)) {
    const row = sheet.addRow(columns.map((column) => excelSafe(calendarExportCell(item, column))));
    row.alignment = { vertical: "top", wrapText: true };
  }

  columns.forEach((column, index) => {
    const wide = column.fieldIds.length > 1 || column.fieldIds.some((id) => WIDE_FIELDS.has(id));
    sheet.getColumn(index + 1).width = wide ? WIDE_COLUMN_WIDTH : COLUMN_WIDTH;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
