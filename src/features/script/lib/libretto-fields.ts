import type { ColumnDef } from "@/shared/hooks/use-table-layout";
import type { ExportColumn, ExportFieldDef } from "@/features/exports/types";
import { createExportColumnId } from "@/features/exports/lib/column-utils";

export type LibrettoFieldDef = ExportFieldDef;

/** @deprecated use ExportColumn — kept as alias for libretto call sites */
export type LibrettoExportColumn = ExportColumn;

/** Все поля, доступные для экспорта */
export const LIBRETTO_EXPORT_FIELDS: LibrettoFieldDef[] = [
  { id: "number", label: "Сцена" },
  { id: "location", label: "Локация" },
  { id: "place", label: "Место" },
  { id: "summary", label: "Описание" },
  { id: "characters", label: "Персонажи" },
  { id: "actors", label: "Актёры" },
  { id: "planSeconds", label: "Хрон. План" },
  { id: "factSeconds", label: "Хрон. Факт" },
  { id: "preEditSeconds", label: "Хрон. Премонтаж" },
  { id: "editSeconds", label: "Хрон. Монтаж" },
  { id: "filmFootagePlan", label: "Метраж план" },
  { id: "filmFootageFact", label: "Метраж факт" },
  { id: "intExt", label: "Инт/Нат" },
  { id: "scriptDay", label: "Сц. день" },
  { id: "dayNight", label: "Режим" },
  { id: "status", label: "Статус" },
  { id: "montageMap", label: "Монтажная карта" },
  { id: "description", label: "Примечание" },
  { id: "extras", label: "Массовка" },
  { id: "group", label: "Групповка" },
  { id: "stunt", label: "Каскадёр" },
  { id: "makeup", label: "Грим" },
];

const TABLE_WIDTHS: Record<string, { defaultWidth: number; minWidth: number }> = {
  number: { defaultWidth: 72, minWidth: 56 },
  location: { defaultWidth: 160, minWidth: 100 },
  summary: { defaultWidth: 200, minWidth: 120 },
  characters: { defaultWidth: 140, minWidth: 90 },
  planSeconds: { defaultWidth: 90, minWidth: 70 },
  factSeconds: { defaultWidth: 90, minWidth: 70 },
  preEditSeconds: { defaultWidth: 110, minWidth: 80 },
  editSeconds: { defaultWidth: 100, minWidth: 80 },
  filmFootagePlan: { defaultWidth: 100, minWidth: 80 },
  filmFootageFact: { defaultWidth: 100, minWidth: 80 },
  intExt: { defaultWidth: 80, minWidth: 64 },
  scriptDay: { defaultWidth: 72, minWidth: 56 },
  dayNight: { defaultWidth: 80, minWidth: 64 },
  status: { defaultWidth: 160, minWidth: 120 },
  montageMap: { defaultWidth: 120, minWidth: 90 },
  description: { defaultWidth: 140, minWidth: 90 },
  extras: { defaultWidth: 120, minWidth: 80 },
  group: { defaultWidth: 120, minWidth: 80 },
  stunt: { defaultWidth: 100, minWidth: 80 },
  makeup: { defaultWidth: 100, minWidth: 80 },
};

/** Столбцы таблицы либретто (без «Место» и «Актёры») */
export const LIBRETTO_COLUMNS: ColumnDef[] = LIBRETTO_EXPORT_FIELDS.filter(
  (field) => field.id !== "place" && field.id !== "actors",
).map((field) => ({
  id: field.id,
  label: field.label,
  defaultWidth: TABLE_WIDTHS[field.id]?.defaultWidth ?? 120,
  minWidth: TABLE_WIDTHS[field.id]?.minWidth ?? 80,
}));

export function getLibrettoFieldLabel(
  fieldId: string,
  resourceLabels?: Record<string, string>,
) {
  if (resourceLabels?.[fieldId]) return resourceLabels[fieldId];
  const resourceId = fieldId.startsWith("rescat:")
    ? fieldId.slice("rescat:".length)
    : null;
  if (resourceId && resourceLabels?.[resourceId]) {
    return resourceLabels[resourceId];
  }
  return (
    LIBRETTO_EXPORT_FIELDS.find((field) => field.id === fieldId)?.label ??
    fieldId
  );
}

export function createDefaultExportColumns(
  resourceCategories: { id: string; name: string }[] = [],
): LibrettoExportColumn[] {
  return buildLibrettoColumns(resourceCategories).map((col) => ({
    id: col.id,
    title: col.label,
    fieldIds: [col.id],
  }));
}

export { createExportColumnId };

export function suggestedExportColumnTitle(
  fieldIds: string[],
  resourceLabels?: Record<string, string>,
) {
  if (fieldIds.length === 0) return "Столбец";
  if (fieldIds.length === 1) {
    return getLibrettoFieldLabel(fieldIds[0]!, resourceLabels);
  }
  return fieldIds
    .map((id) => getLibrettoFieldLabel(id, resourceLabels))
    .join(" / ");
}

/**
 * Поля для конструктора экспорта:
 * столбцы таблицы либретто + любые категории из раздела «Ресурсы».
 */
export function buildLibrettoExportFields(
  tableResourceCategories: { id: string; name: string }[] = [],
  allResourceCategories: { id: string; name: string }[] = [],
): ExportFieldDef[] {
  const byId = new Map<string, ExportFieldDef>();
  for (const col of buildLibrettoColumns(tableResourceCategories)) {
    byId.set(col.id, { id: col.id, label: col.label });
  }
  for (const cat of allResourceCategories) {
    const id = resourceColumnId(cat.id);
    if (!byId.has(id)) {
      byId.set(id, { id, label: cat.name });
    }
  }
  return [...byId.values()];
}

export function librettoFieldLabelsMap(
  fields: ExportFieldDef[],
): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.id, f.label]));
}

export const RESOURCE_COLUMN_PREFIX = "rescat:";

export function resourceColumnId(categoryId: string) {
  return `${RESOURCE_COLUMN_PREFIX}${categoryId}`;
}

export function isResourceColumnId(fieldId: string) {
  return fieldId.startsWith(RESOURCE_COLUMN_PREFIX);
}

export function parseResourceColumnId(fieldId: string): string | null {
  if (!isResourceColumnId(fieldId)) return null;
  return fieldId.slice(RESOURCE_COLUMN_PREFIX.length);
}

/** Базовые столбцы + категории ресурсов проекта. */
export function buildLibrettoColumns(
  resourceCategories: { id: string; name: string }[] = [],
): ColumnDef[] {
  const resourceCols: ColumnDef[] = resourceCategories.map((cat) => ({
    id: resourceColumnId(cat.id),
    label: cat.name,
    defaultWidth: 120,
    minWidth: 80,
  }));
  return [...LIBRETTO_COLUMNS, ...resourceCols];
}
