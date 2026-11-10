import type { ExportColumn, ExportFieldDef } from "@/features/exports/types";

/**
 * Поля и колонки выгрузки сметы цеха по статьям в Excel (конструктор колонок). Без exceljs —
 * этот файл нужен и браузеру.
 */

export const SMETA_EXPORT_FIELDS = [
  { id: "code", label: "Код" },
  { id: "name", label: "Наименование" },
  { id: "expenseType", label: "Тип" },
  { id: "unit", label: "Ед." },
  { id: "quantity", label: "Кол-во" },
  { id: "rate", label: "Ставка" },
  { id: "multipliers", label: "Множители" },
  { id: "paymentForm", label: "Форма оплаты" },
  { id: "taxPercent", label: "Налог, %" },
  { id: "amount", label: "Сумма" },
  { id: "tax", label: "Налог" },
  { id: "total", label: "Итого" },
] as const satisfies readonly ExportFieldDef[];

export type SmetaExportFieldId = (typeof SMETA_EXPORT_FIELDS)[number]["id"];

const FIELD_IDS = new Set<string>(SMETA_EXPORT_FIELDS.map((f) => f.id));
const MAX_COLUMNS = 30;

export function smetaDefaultExportColumns(): ExportColumn[] {
  return SMETA_EXPORT_FIELDS.map(({ id, label }) => ({ id, title: label, fieldIds: [id] }));
}

/**
 * Колонки из браузера или из памяти: неизвестные поля выбрасываются, пустые колонки тоже;
 * ничего не осталось — колонки по умолчанию.
 */
export function smetaExportColumns(raw: unknown): ExportColumn[] {
  if (!Array.isArray(raw)) return smetaDefaultExportColumns();
  const columns: ExportColumn[] = [];
  for (const item of raw.slice(0, MAX_COLUMNS)) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const fieldIds = Array.isArray(c.fieldIds)
      ? c.fieldIds.filter((f): f is string => typeof f === "string" && FIELD_IDS.has(f)).slice(0, 12)
      : [];
    if (fieldIds.length === 0) continue;
    columns.push({
      id: typeof c.id === "string" ? c.id.slice(0, 64) : `col-${columns.length}`,
      title: typeof c.title === "string" && c.title.trim() ? c.title.trim().slice(0, 80) : "Столбец",
      fieldIds,
    });
  }
  return columns.length > 0 ? columns : smetaDefaultExportColumns();
}

