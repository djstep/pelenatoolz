import type { ProjectType } from "@prisma/client";
import ExcelJS from "exceljs";
import { resolveColumnHeader } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import type { KppExportBundle, KppExportDay } from "@/features/schedule/lib/kpp-export-data";
import {
  buildFullRowsForDay,
  buildKppExportCell,
  getKppFullCellValue,
  getKppShortCellValue,
  type KppFullRow,
  type KppShortRow,
} from "@/features/schedule/lib/kpp-export-cells";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9D9D9" },
};

const BREAK_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};

export type KppExportMode = "full" | "short";

export type KppExportOptions = {
  mode: KppExportMode;
  columns: ExportColumn[];
  fieldLabels: Record<string, string>;
  includeTechnicalBreaks: boolean;
  showWeekday: boolean;
  /** `all` = sheet per unit; otherwise filter to this unit key */
  unitScope: "all" | string;
  projectType: ProjectType;
};

function unitKey(day: KppExportDay) {
  return day.unit?.trim() || "main";
}

function unitSheetName(unit: string, index: number) {
  const raw = unit === "main" ? "Основная" : unit;
  const safe = raw.replace(/[\\/*?[\]:]/g, "_").slice(0, 28);
  return safe || `Группа ${index + 1}`;
}

function filterDays(bundle: KppExportBundle, unitScope: "all" | string) {
  if (unitScope === "all") return bundle.days;
  return bundle.days.filter((d) => unitKey(d) === unitScope);
}

function groupByUnit(days: KppExportDay[]) {
  const map = new Map<string, KppExportDay[]>();
  for (const day of days) {
    const key = unitKey(day);
    const list = map.get(key) ?? [];
    list.push(day);
    map.set(key, list);
  }
  return map;
}

function writeHeader(sheet: ExcelJS.Worksheet, columns: ExportColumn[]) {
  const headerRow = sheet.addRow(columns.map((col) => resolveColumnHeader(col)));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, name: "Calibri", size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function writeFullSheet(
  sheet: ExcelJS.Worksheet,
  days: KppExportDay[],
  options: KppExportOptions,
) {
  writeHeader(sheet, options.columns);
  for (const day of days) {
    const rows = buildFullRowsForDay(day, options.includeTechnicalBreaks);
    for (const row of rows) {
      appendFullDataRow(sheet, row, options);
    }
  }
  sheet.columns.forEach((column) => {
    column.width = 18;
  });
}

function appendFullDataRow(
  sheet: ExcelJS.Worksheet,
  row: KppFullRow,
  options: KppExportOptions,
) {
  const excelRow = sheet.addRow([]);
  options.columns.forEach((col, index) => {
    const parts = col.fieldIds.map((id) => ({
      label: options.fieldLabels[id] ?? id,
      value: getKppFullCellValue(row, id, options.projectType, {
        showWeekday: options.showWeekday,
      }),
    }));
    const value = buildKppExportCell(parts, col.fieldIds.length > 1);
    const cell = excelRow.getCell(index + 1);
    cell.value = value;
    cell.alignment = { vertical: "top", wrapText: true };
    if (row.kind === "break") cell.fill = BREAK_FILL;
  });
}

function writeShortSheet(
  sheet: ExcelJS.Worksheet,
  days: KppExportDay[],
  options: KppExportOptions,
) {
  writeHeader(sheet, options.columns);
  for (const day of days) {
    const row: KppShortRow = { day };
    const excelRow = sheet.addRow([]);
    options.columns.forEach((col, index) => {
      const parts = col.fieldIds.map((id) => ({
        label: options.fieldLabels[id] ?? id,
        value: getKppShortCellValue(row, id, {
          showWeekday: options.showWeekday,
        }),
      }));
      const value = buildKppExportCell(parts, col.fieldIds.length > 1);
      const cell = excelRow.getCell(index + 1);
      cell.value = value;
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }
  sheet.columns.forEach((column) => {
    column.width = 20;
  });
}

export async function exportKppXls(
  bundle: KppExportBundle,
  options: KppExportOptions,
) {
  const workbook = new ExcelJS.Workbook();
  const filtered = filterDays(bundle, options.unitScope);

  if (options.unitScope === "all" && bundle.units.length > 1) {
    const groups = groupByUnit(filtered);
    let i = 0;
    for (const [unit, days] of groups) {
      const sheet = workbook.addWorksheet(unitSheetName(unit, i++));
      if (options.mode === "full") writeFullSheet(sheet, days, options);
      else writeShortSheet(sheet, days, options);
    }
    if (workbook.worksheets.length === 0) {
      workbook.addWorksheet("КПП");
    }
  } else {
    const sheet = workbook.addWorksheet(
      options.mode === "full" ? "КПП полный" : "КПП краткий",
    );
    if (options.mode === "full") writeFullSheet(sheet, filtered, options);
    else writeShortSheet(sheet, filtered, options);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const suffix = options.mode === "full" ? "full" : "short";
  anchor.download = `kpp-${suffix}-${bundle.projectId.slice(0, 8)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
