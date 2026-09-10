/** Shared types for tabular export column layouts (libretto, KPP, etc.). */

export const EXPORT_LAYOUT_KEYS = [
  "libretto",
  "kppFull",
  "kppShort",
  "directorsScript",
] as const;

export type ExportLayoutKey = (typeof EXPORT_LAYOUT_KEYS)[number];

export type ExportFieldDef = {
  id: string;
  label: string;
};

export type ExportColumn = {
  id: string;
  title: string;
  fieldIds: string[];
  /** When true, file header is «Дополнительные ресурсы» instead of title / field names. */
  isExtrasBucket?: boolean;
};

export type ExportLayout = {
  columns: ExportColumn[];
  /** Полный КПП: переносить тех. перерывы из вызывных */
  includeTechnicalBreaks?: boolean;
  /** Краткий КПП: показывать дни недели */
  showWeekday?: boolean;
};

/** Явочный лист: актёры и цеха всегда включены; здесь — доп. ресурсы. */
export type AttendanceSheetSettings = {
  resourceIds: string[];
};

export type ExportSettings = Partial<Record<ExportLayoutKey, ExportLayout>> & {
  attendanceSheet?: AttendanceSheetSettings;
};

export const EXTRAS_BUCKET_HEADER = "Дополнительные ресурсы";

/** Встроенные блоки ресурсов для настроек явочного листа. */
export const ATTENDANCE_BUILTIN_SECTIONS = [
  { id: "scene:extras", label: "Массовка / групповка" },
  { id: "scene:stunts", label: "Трюк / каскадёры" },
  { id: "scene:props", label: "Реквизит" },
  { id: "scene:art", label: "Художественный цех" },
  { id: "scene:camera", label: "Операторская техника" },
  { id: "scene:vehicles", label: "Игровой транспорт" },
  { id: "special:transport", label: "Спецтранспорт" },
] as const;

export function attendanceCategorySectionId(categoryId: string) {
  return `resourceCategory:${categoryId}`;
}

export function parseAttendanceCategorySectionId(id: string): string | null {
  if (!id.startsWith("resourceCategory:")) return null;
  return id.slice("resourceCategory:".length) || null;
}
