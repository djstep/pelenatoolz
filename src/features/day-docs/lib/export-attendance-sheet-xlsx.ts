import ExcelJS from "exceljs";
import {
  ATTENDANCE_ACTOR_COLUMNS,
  type AttendanceSheetModel,
} from "@/features/day-docs/lib/export-attendance-sheet";

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

const GRID_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};

/** Ширины под A4 альбомную; «Переработка» и «Подпись» — под запись от руки. */
const ACTOR_COLUMN_WIDTHS = [28, 24, 9, 17, 15, 17, 26];
/** ≈ 9 мм — место для подписи ручкой. */
const ACTOR_ROW_HEIGHT = 26;
const ACTOR_HEADER_ROW = 4;

function addActorTableSheet(
  workbook: ExcelJS.Workbook,
  table: AttendanceSheetModel["actorTables"][number],
) {
  const columnCount = ATTENDANCE_ACTOR_COLUMNS.length;
  const sheet = workbook.addWorksheet(table.sheetName, {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: `${ACTOR_HEADER_ROW}:${ACTOR_HEADER_ROW}`,
    },
  });
  ACTOR_COLUMN_WIDTHS.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });

  const title = sheet.addRow([table.title]);
  title.getCell(1).font = { bold: true, size: 14, name: "Arial" };
  title.getCell(1).alignment = { vertical: "middle" };
  title.height = 24;
  sheet.mergeCells(1, 1, 1, columnCount);

  const place = sheet.addRow([table.placeLine]);
  place.getCell(1).font = { size: 11, name: "Arial" };
  place.getCell(1).alignment = { vertical: "top", wrapText: true };
  // В объединённой ячейке Excel сам высоту не подбирает: ~120 знаков в строке.
  place.height = 16 * Math.max(1, Math.ceil(table.placeLine.length / 120));
  sheet.mergeCells(2, 1, 2, columnCount);

  sheet.addRow([]).height = 6;

  const header = sheet.addRow([...ATTENDANCE_ACTOR_COLUMNS]);
  header.eachCell((cell) => {
    cell.font = { bold: true, size: 11, name: "Arial" };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = GRID_BORDER;
  });
  header.height = 30;

  if (table.rows.length === 0) {
    const empty = sheet.addRow(["В сценах дня нет персонажей"]);
    sheet.mergeCells(empty.number, 1, empty.number, columnCount);
    empty.getCell(1).font = { size: 11, name: "Arial" };
    empty.getCell(1).alignment = { vertical: "middle" };
    for (let col = 1; col <= columnCount; col += 1) {
      empty.getCell(col).border = GRID_BORDER;
    }
    empty.height = ACTOR_ROW_HEIGHT;
    return;
  }

  for (const row of table.rows) {
    const dataRow = sheet.addRow([row.actor, row.character, row.callTime ?? "", "", "", "", ""]);
    for (let col = 1; col <= columnCount; col += 1) {
      const cell = dataRow.getCell(col);
      cell.font = { size: 11, name: "Arial" };
      cell.alignment = {
        vertical: "middle",
        wrapText: true,
        horizontal: col === 3 ? "center" : "left",
        indent: col === 3 ? 0 : 1,
      };
      cell.border = GRID_BORDER;
    }
    dataRow.height = ACTOR_ROW_HEIGHT;
  }
}

export async function buildAttendanceSheetXlsx(model: AttendanceSheetModel) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  workbook.created = new Date();

  for (const table of model.actorTables) {
    addActorTableSheet(workbook, table);
  }

  for (const section of model.sections) {
    const sheet = workbook.addWorksheet(section.title);
    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 32;
    sheet.getColumn(3).width = 28;
    sheet.getColumn(4).width = 12;
    sheet.getColumn(5).width = 14;
    sheet.getColumn(6).width = 18;

    const title = sheet.addRow([model.documentTitle]);
    title.getCell(1).font = { bold: true, size: 14, name: "Calibri" };
    sheet.mergeCells(1, 1, 1, 6);

    sheet.addRow([model.projectName]).getCell(1).font = {
      bold: true,
      size: 12,
      name: "Calibri",
    };
    sheet.mergeCells(2, 1, 2, 6);

    sheet.addRow([
      `${model.dateLabel}${model.city ? ` · ${model.city}` : ""} · ${section.title}`,
    ]);
    sheet.mergeCells(3, 1, 3, 6);
    sheet.addRow([]);

    const header = sheet.addRow([
      "№",
      "ФИО / наименование",
      "Детали",
      "Вызов",
      "Прибыл",
      "Подпись",
    ]);
    styleHeaderRow(header);

    if (section.rows.length === 0) {
      sheet.addRow(["", "Нет записей в вызывном", "", "", "", ""]);
    } else {
      section.rows.forEach((row, index) => {
        const dataRow = sheet.addRow([
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

    sheet.addRow([]);
    sheet.addRow([
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
