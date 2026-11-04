import ExcelJS from "exceljs";
import { crewExportCell } from "@/features/crew/lib/crew-export";
import type { CrewGroup } from "@/features/crew/lib/crew-rules";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import { excelSafe } from "@/shared/lib/excel-safe";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const COLUMN_WIDTH = 20;
const WIDE_COLUMN_WIDTH = 32;
const WIDE_FIELDS = new Set(["fullName", "email", "note"]);

/**
 * Лист Excel: плоская таблица в порядке цехов. Цех — обычная колонка, а не строка-заголовок:
 * так работают сортировка и фильтры. Значения — как ввели люди, поэтому через `excelSafe`.
 */
export async function buildCrewWorkbook(columns: ExportColumn[], groups: CrewGroup[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Команда", { views: [{ state: "frozen", ySplit: 1 }] });

  const header = sheet.addRow(columns.map((column) => excelSafe(resolveColumnHeader(column))));
  header.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  for (const group of groups) {
    for (const row of group.rows) {
      const cells = sheet.addRow(columns.map((column) => excelSafe(crewExportCell(row, column))));
      cells.alignment = { vertical: "top", wrapText: true };
    }
  }

  columns.forEach((column, index) => {
    const wide = column.fieldIds.length > 1 || column.fieldIds.some((id) => WIDE_FIELDS.has(id));
    sheet.getColumn(index + 1).width = wide ? WIDE_COLUMN_WIDTH : COLUMN_WIDTH;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
