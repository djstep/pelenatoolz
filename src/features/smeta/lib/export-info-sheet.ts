import type ExcelJS from "exceljs";
import { excelSafe } from "@/shared/lib/excel-safe";

export const EXPORT_INFO_SHEET_NAME = "О выгрузке";

/** Строки служебного листа: что за документ, какая версия, кто и когда. Сумм здесь нет. */
export type ExportInfo = {
  document: string;
  project: string;
  status: string;
  version: string | null;
  approved: string | null;
  exportedBy: string;
  exportedAt: string;
};

/** «03.11.2026 14:20» по поясу проекта — на сервере (UTC) без пояса время было бы чужим. */
export function formatExportDateTime(value: Date, timezone: string | null): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone || "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
}

export const EXPORT_INFO_NOTE = "Итоговая смета — только из системы PELENA. Утверждение — только в системе.";

/**
 * Служебный лист «О выгрузке» в конце книги: документ, проект, статус, версия, кто утвердил,
 * кто и когда выгрузил. Метка не вписывается в сам лист сметы — номера строк совпадают с системой.
 * Лист с таким именем уже есть (цех так назван) — «О выгрузке (PELENA)».
 */
export function addExportInfoSheet(workbook: ExcelJS.Workbook, info: ExportInfo) {
  const taken = new Set(workbook.worksheets.map((s) => s.name.toLowerCase()));
  const name = taken.has(EXPORT_INFO_SHEET_NAME.toLowerCase())
    ? `${EXPORT_INFO_SHEET_NAME} (PELENA)`
    : EXPORT_INFO_SHEET_NAME;
  const sheet = workbook.addWorksheet(name);
  const rows: [string, string | null][] = [
    ["Документ", info.document],
    ["Проект", info.project],
    ["Статус", info.status],
    ["Версия", info.version],
    ["Утверждена", info.approved],
    ["Выгрузил", info.exportedBy],
    ["Когда", info.exportedAt],
  ];
  let r = 1;
  for (const [label, value] of rows) {
    if (value === null) continue;
    sheet.getCell(r, 1).value = label;
    sheet.getCell(r, 1).font = { bold: true };
    sheet.getCell(r, 2).value = excelSafe(value);
    r++;
  }
  sheet.getCell(r + 1, 1).value = EXPORT_INFO_NOTE;
  sheet.getColumn(1).width = 16;
  sheet.getColumn(2).width = 60;
  return sheet;
}
