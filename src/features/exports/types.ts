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

export type ExportSettings = Partial<Record<ExportLayoutKey, ExportLayout>>;

export const EXTRAS_BUCKET_HEADER = "Дополнительные ресурсы";
