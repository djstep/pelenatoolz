import ExcelJS from "exceljs";
import {
  ATTENDANCE_ACTOR_COLUMNS,
  type AttendanceSheetModel,
} from "@/features/day-docs/lib/export-attendance-sheet";
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
/** Шапка и «Место съёмки» — над колонками до «Конца смены»; правее — логотип. */
const ACTOR_TITLE_COLUMNS = 5;

/** Логотип PELENA 1024×219: справа в углу над «Переработкой» и «Подписью». */
const LOGO_WIDTH_PX = 220;
const LOGO_HEIGHT_PX = Math.round((LOGO_WIDTH_PX * 219) / 1024);

/** Ширина колонки Excel в пикселях (шрифт книги по умолчанию — Calibri 11, 7 px на знак). */
function columnPx(width: number) {
  return Math.trunc(width * 7);
}

const EMU_PER_PX = 9525;

/**
 * Левый верхний угол логотипа так, чтобы правый край лёг на правый край таблицы.
 * Смещение задаётся в EMU напрямую: дробную колонку ExcelJS пересчитывает
 * в свои единицы (ширина × 10 000), а не в единицы Excel — логотип съезжал влево.
 */
function logoAnchor() {
  let left = ACTOR_COLUMN_WIDTHS.reduce((sum, w) => sum + columnPx(w), 0) - LOGO_WIDTH_PX;
  let nativeCol = 0;
  while (nativeCol < ACTOR_COLUMN_WIDTHS.length - 1 && left >= columnPx(ACTOR_COLUMN_WIDTHS[nativeCol])) {
    left -= columnPx(ACTOR_COLUMN_WIDTHS[nativeCol]);
    nativeCol += 1;
  }
  return {
    nativeCol,
    nativeColOff: Math.max(0, Math.round(left * EMU_PER_PX)),
    nativeRow: 0,
    nativeRowOff: 4 * EMU_PER_PX,
  };
}

function addActorTableSheet(
  workbook: ExcelJS.Workbook,
  table: AttendanceSheetModel["actorTables"][number],
  logoImageId: number | null,
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

  // В объединённой ячейке Excel сам высоту не подбирает: считаем строки по длине текста.
  const title = addSafeRow(sheet, [table.title]);
  title.getCell(1).font = { bold: true, size: 14, name: "Arial" };
  title.getCell(1).alignment = { vertical: "middle", wrapText: true };
  title.height = 22 * Math.max(1, Math.ceil(table.title.length / 60));
  sheet.mergeCells(1, 1, 1, ACTOR_TITLE_COLUMNS);

  const place = addSafeRow(sheet, [table.placeLine]);
  place.getCell(1).font = { size: 11, name: "Arial" };
  place.getCell(1).alignment = { vertical: "top", wrapText: true };
  place.height = 16 * Math.max(1, Math.ceil(table.placeLine.length / 90));
  sheet.mergeCells(2, 1, 2, ACTOR_TITLE_COLUMNS);

  if (logoImageId != null) {
    sheet.addImage(logoImageId, {
      // Типы ExcelJS знают только { col, row }; Anchor принимает и native-поля.
      tl: logoAnchor() as unknown as { col: number; row: number },
      ext: { width: LOGO_WIDTH_PX, height: LOGO_HEIGHT_PX },
      editAs: "oneCell",
    });
  }

  addSafeRow(sheet, []).height = 6;

  const header = addSafeRow(sheet, [...ATTENDANCE_ACTOR_COLUMNS]);
  header.eachCell((cell) => {
    cell.font = { bold: true, size: 11, name: "Arial" };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = GRID_BORDER;
  });
  header.height = 30;

  if (table.rows.length === 0) {
    const empty = addSafeRow(sheet, ["В сценах дня нет персонажей"]);
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
    const dataRow = addSafeRow(sheet, [row.actor, row.character, row.callTime ?? "", "", "", "", ""]);
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

export async function buildAttendanceSheetXlsx(
  model: AttendanceSheetModel,
  /** PNG логотипа для актёрских листов; нет — лист без логотипа. */
  logoPng?: Uint8Array | null,
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PELENA";
  workbook.created = new Date();

  const logoImageId = logoPng
    ? workbook.addImage({
        buffer: Buffer.from(logoPng) as unknown as ExcelJS.Buffer,
        extension: "png",
      })
    : null;

  for (const table of model.actorTables) {
    addActorTableSheet(workbook, table, logoImageId);
  }

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
