import {
  ATTENDANCE_BUILTIN_SECTIONS,
  EXTRAS_BUCKET_HEADER,
  EXPORT_LAYOUT_KEYS,
  parseAttendanceCategorySectionId,
  type AttendanceSheetSettings,
  type ExportColumn,
  type ExportFieldDef,
  type ExportLayout,
  type ExportLayoutKey,
  type ExportSettings,
} from "@/features/exports/types";
import type { Permission } from "@/features/memberships/permissions";

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

/** Право раздела для раскладки: чтение — загрузка в окно, правка — сохранение в проект. */
const EXPORT_LAYOUT_PERMISSIONS: Record<
  ExportLayoutKey,
  { read: Permission; write: Permission }
> = {
  libretto: { read: "script:read", write: "script:write" },
  directorsScript: { read: "script:read", write: "script:write" },
  kppFull: { read: "schedule:read", write: "schedule:write" },
  kppShort: { read: "schedule:read", write: "schedule:write" },
  crew: { read: "crew:read", write: "crew:write" },
  prepCalendar: { read: "calendar:read", write: "calendar:write" },
};

/**
 * Раскладка общая на проект, а часть колонок команды видна не всем: сохранит участник без
 * «Команда: контакты» — и у остальных пропадут телефоны. Поэтому раскладку команды сохраняет
 * только тот, кому доступны все её колонки.
 */
const EXPORT_LAYOUT_SAVE_EXTRA: Partial<Record<ExportLayoutKey, Permission[]>> = {
  crew: ["crew:contacts", "contracts:read"],
};

/**
 * «Настройка явочного листа» — настройка раздела «КПП и вызывные»: сохраняет только участник
 * с правкой этого раздела. Открыть окно и выгрузить явочный лист можно и без неё.
 */
export const ATTENDANCE_SHEET_WRITE_PERMISSION: Permission = "schedule:write";

export function exportLayoutPermission(
  key: ExportLayoutKey,
  action: "read" | "write",
): Permission {
  return EXPORT_LAYOUT_PERMISSIONS[key][action];
}

/** Все права, нужные для сохранения раскладки в проект. */
export function exportLayoutSavePermissions(key: ExportLayoutKey): Permission[] {
  return [EXPORT_LAYOUT_PERMISSIONS[key].write, ...(EXPORT_LAYOUT_SAVE_EXTRA[key] ?? [])];
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

export function normalizeAttendanceSheetSettings(
  raw: unknown,
): AttendanceSheetSettings | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.resourceIds)) return { resourceIds: [] };
  return {
    resourceIds: o.resourceIds.filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    ),
  };
}

/**
 * Id блоков явочного листа, которые можно сохранить: встроенные блоки и категории ресурсов
 * этого проекта (`projectCategoryIds`). Прочие id и повторы отбрасываются.
 */
export function keepProjectAttendanceSectionIds(
  ids: readonly string[],
  projectCategoryIds: ReadonlySet<string>,
): string[] {
  const builtin = new Set<string>(ATTENDANCE_BUILTIN_SECTIONS.map((s) => s.id));
  const kept = new Set<string>();
  for (const id of ids) {
    const categoryId = parseAttendanceCategorySectionId(id);
    if (builtin.has(id) || (categoryId && projectCategoryIds.has(categoryId))) kept.add(id);
  }
  return [...kept];
}

export function parseExportSettings(raw: unknown): ExportSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ExportSettings = {};
  for (const key of EXPORT_LAYOUT_KEYS) {
    const layout = normalizeExportLayout(src[key]);
    if (layout) out[key] = layout;
  }
  const attendance = normalizeAttendanceSheetSettings(src.attendanceSheet);
  if (attendance) out.attendanceSheet = attendance;
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
