import ExcelJS from "exceljs";
import type { AttendanceSheetModel } from "@/features/day-docs/lib/export-attendance-sheet";
import { excelSafe } from "@/shared/lib/excel-safe";

/** Единственная запись строк листа: каждое строковое значение — через `excelSafe`. */
function addSafeRow(sheet: ExcelJS.Worksheet, values: (string | number)[]) {
  return sheet.addRow(values.map((value) => excelSafe(value)));
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: "center" };
  });
  row.height = 22;
}

export async function buildAttendanceSheetXlsx(model: AttendanceSheetModel) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  workbook.created = new Date();

  for (const section of model.sections) {
    const sheet = workbook.addWorksheet(section.title);
    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 32;
    sheet.getColumn(3).width = 28;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 14;
    sheet.getColumn(6).width = 18;

    const title = addSafeRow(sheet, [model.documentTitle]);
    title.getCell(1).font = { bold: true, size: 14, name: "Calibri" };
    sheet.mergeCells(1, 1, 1, 6);

    addSafeRow(sheet, [model.projectName]).getCell(1).font = {
      bold: true,
      size: 12,
      name: "Calibri",
    };
    sheet.mergeCells(2, 1, 2, 6);

    addSafeRow(sheet, [
      `${model.dateLabel}${model.city ? ` · ${model.city}` : ""} · ${section.title}`,
    ]);
    sheet.mergeCells(3, 1, 3, 6);
    addSafeRow(sheet, []);

    const header = addSafeRow(sheet, [
      "№",
      "ФИО / наименование",
      "Детали",
      "Вызов",
      "Прибыл",
      "Подпись",
    ]);
    styleHeaderRow(header);

    if (section.rows.length === 0) {
      addSafeRow(sheet, ["", section.emptyText ?? "Нет записей в вызывном", "", "", "", ""]);
    } else {
      section.rows.forEach((row, index) => {
        const dataRow = addSafeRow(sheet, [
          index + 1,
          row.name,
          row.detail ?? "",
          row.callTime ?? "",
          "",
          "",
        ]);
        dataRow.eachCell((cell, col) => {
          cell.alignment = {
            vertical: "middle",
            wrapText: true,
            horizontal: col === 1 || col === 4 ? "center" : "left",
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFBFBFBF" } },
            left: { style: "thin", color: { argb: "FFBFBFBF" } },
            bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
            right: { style: "thin", color: { argb: "FFBFBFBF" } },
          };
        });
        dataRow.height = 22;
      });
    }

    addSafeRow(sheet, []);
    addSafeRow(sheet, [
      "Ведомость фактического присутствия на смене. Заполняется и подписывается на площадке в конце смены.",
    ]);
    sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 6);
    sheet.getRow(sheet.rowCount).getCell(1).font = {
      italic: true,
      size: 9,
      name: "Calibri",
      color: { argb: "FF666666" },
    };
  }

  return workbook.xlsx.writeBuffer();
}
