import {
  EXTRAS_BUCKET_HEADER,
  EXPORT_LAYOUT_KEYS,
  type ExportColumn,
  type ExportFieldDef,
  type ExportLayout,
  type ExportLayoutKey,
  type ExportSettings,
} from "@/features/exports/types";

export function createExportColumnId() {
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function suggestedColumnTitle(
  fieldIds: string[],
  fields: ExportFieldDef[],
): string {
  if (fieldIds.length === 0) return "Столбец";
  const labels = fieldIds.map(
    (id) => fields.find((f) => f.id === id)?.label ?? id,
  );
  if (labels.length === 1) return labels[0]!;
  return labels.join(" / ");
}

/** Header written into the exported file. */
export function resolveColumnHeader(col: ExportColumn): string {
  if (col.isExtrasBucket) return EXTRAS_BUCKET_HEADER;
  const title = col.title?.trim();
  return title || "Столбец";
}

export function isExportLayoutKey(value: string): value is ExportLayoutKey {
  return (EXPORT_LAYOUT_KEYS as readonly string[]).includes(value);
}

export function normalizeExportColumn(raw: unknown): ExportColumn | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.title !== "string") return null;
  if (!Array.isArray(o.fieldIds)) return null;
  const fieldIds = o.fieldIds.filter((id): id is string => typeof id === "string");
  return {
    id: o.id,
    title: o.title,
    fieldIds,
    isExtrasBucket: Boolean(o.isExtrasBucket),
  };
}

export function normalizeExportLayout(raw: unknown): ExportLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.columns)) return null;
  const columns = o.columns
    .map(normalizeExportColumn)
    .filter((c): c is ExportColumn => c != null);
  if (columns.length === 0) return null;
  return {
    columns,
    includeTechnicalBreaks:
      typeof o.includeTechnicalBreaks === "boolean"
        ? o.includeTechnicalBreaks
        : undefined,
    showWeekday:
      typeof o.showWeekday === "boolean" ? o.showWeekday : undefined,
  };
}

export function parseExportSettings(raw: unknown): ExportSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ExportSettings = {};
  for (const key of EXPORT_LAYOUT_KEYS) {
    const layout = normalizeExportLayout(src[key]);
    if (layout) out[key] = layout;
  }
  return out;
}

export function findFieldUsage(
  columns: ExportColumn[],
  fieldId: string,
  exceptColumnId?: string,
): ExportColumn[] {
  return columns.filter(
    (col) =>
      col.id !== exceptColumnId && col.fieldIds.includes(fieldId),
  );
}

export function columnsReadyForExport(columns: ExportColumn[]): ExportColumn[] {
  return columns.filter((col) => col.fieldIds.length > 0);
}
