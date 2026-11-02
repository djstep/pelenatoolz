import {
  budgetDriveStatusLabel,
  type BudgetDriveSource,
} from "@/features/cloud/lib/budget-drive-export-rules";
import { buildSummaryWorkbook } from "@/features/smeta/lib/export-summary-xlsx";
import {
  addExportInfoSheet,
  formatExportDateTime,
  type ExportInfo,
} from "@/features/smeta/lib/export-info-sheet";
import { assembleWorkbookFromSheets } from "@/features/smeta/lib/workbook-model";
import { formatFileDate } from "@/shared/i18n/format-date";

/**
 * Excel сметы цеха — тот же файл уходит на диск проекта (`BUDGET_DRIVE_NOTES.md`, решения 2–4, 13):
 * только основной лист (утверждённая версия или текущий лист, формулы заменены значениями) и
 * служебный лист «О выгрузке». Черновые листы книги не выгружаются. Построитель — тот же, что у
 * сводной (`buildSummaryWorkbook`): значения, объединения, ширины, закрепление, жирный, формат чисел.
 */

/** Основной лист для выгрузки: формулы уже заменены значениями (`freezeSheetFormulas`). */
export type DepartmentExportSheet = { name: string; data: Record<string, unknown>; styles: unknown };

/** Имя листа Excel: без []:*?/\, до 31 знака. */
function excelSheetName(raw: string) {
  return raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Смета";
}

export function buildDepartmentBudgetWorkbook(sheet: DepartmentExportSheet, info: ExportInfo) {
  const book = assembleWorkbookFromSheets({
    budgetId: "department-export",
    name: "Смета",
    styles: sheet.styles,
    sheets: [{ id: "main", name: excelSheetName(sheet.name), sortOrder: 0, data: sheet.data }],
  });
  const workbook = buildSummaryWorkbook(book);
  addExportInfoSheet(workbook, info);
  return workbook;
}

/** Строки «О выгрузке» для сметы цеха. */
export function departmentExportInfo(input: {
  projectName: string;
  departmentName: string;
  source: BudgetDriveSource;
  approved: { at: Date; byName: string; byHead: boolean } | null;
  exportedBy: string;
  exportedAt: Date;
  timezone: string | null;
}): ExportInfo {
  const { source, approved, timezone } = input;
  return {
    document: `Смета цеха «${input.departmentName}»`,
    project: input.projectName,
    status: budgetDriveStatusLabel(source),
    version: source.kind === "version" ? `версия ${source.number}` : "текущий лист (не утверждён)",
    approved: approved
      ? `${formatExportDateTime(approved.at, timezone)}, ${approved.byName}${
          approved.byHead ? " (утвердил глава цеха)" : ""
        }`
      : null,
    exportedBy: input.exportedBy,
    exportedAt: formatExportDateTime(input.exportedAt, timezone),
  };
}

/** Что выгружено — в журнал и сообщение: «версия 3 (утверждена)» / «текущий лист (на утверждении)». */
export function departmentExportLabel(source: BudgetDriveSource): string {
  return source.kind === "version"
    ? `версия ${source.number} (утверждена)`
    : `текущий лист (${budgetDriveStatusLabel(source)})`;
}

/** Имя файла при скачивании: `smeta-ХУД-v3-2026-11-03.xlsx` / `smeta-ХУД-draft-2026-11-03.xlsx`. */
export function departmentExportFileName(
  codePrefix: string,
  source: BudgetDriveSource,
  exportedAt: Date,
  timezone: string | null,
): string {
  const which = source.kind === "version" ? `v${source.number}` : "draft";
  const prefix = codePrefix.replace(/[^\p{L}\p{N}]/gu, "") || "dept";
  return `smeta-${prefix}-${which}-${formatFileDate(exportedAt, timezone)}.xlsx`;
}

/** Из браузера — только номер утверждённой версии (пусто — по умолчанию); мусор — false. */
export function parseDepartmentExportVersion(raw: unknown): number | undefined | false {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  const version = (raw as { version?: unknown }).version;
  if (version === undefined || version === null) return undefined;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 999_999) {
    return false;
  }
  return version;
}
