import type { ExportColumn, ExportFieldDef } from "@/features/exports/types";
import { createExportColumnId } from "@/features/exports/lib/column-utils";
import {
  RESOURCE_COLUMN_PREFIX,
  resourceColumnId,
} from "@/features/script/lib/libretto-fields";

/** Поля полного КПП (строка ≈ сцена / тех. перерыв). */
export const KPP_FULL_BASE_FIELDS: ExportFieldDef[] = [
  { id: "dayNumber", label: "День №" },
  { id: "date", label: "Дата" },
  { id: "dayType", label: "Тип дня" },
  { id: "isNightShift", label: "Ночная смена" },
  { id: "callTime", label: "Сбор" },
  { id: "wrapTime", label: "Завершение" },
  { id: "sceneNumber", label: "Сцена" },
  { id: "location", label: "Объект" },
  { id: "intExt", label: "Инт/Нат" },
  { id: "dayNight", label: "Режим" },
  { id: "characters", label: "Персонажи" },
  { id: "planSeconds", label: "Хронометраж" },
  { id: "pageCount", label: "Страницы" },
  { id: "status", label: "Статус" },
  { id: "title", label: "Название" },
  { id: "summary", label: "Описание" },
  { id: "scriptDay", label: "Сц. день" },
  { id: "breakLabel", label: "Тех. перерыв" },
  { id: "breakTime", label: "Время перерыва" },
  { id: "comment", label: "Комментарий дня" },
];

/** Поля краткого КПП (строка ≈ съёмочный день). */
export const KPP_SHORT_BASE_FIELDS: ExportFieldDef[] = [
  { id: "dayNumber", label: "День №" },
  { id: "date", label: "Дата" },
  { id: "weekday", label: "День недели" },
  { id: "dayType", label: "Тип дня" },
  { id: "sceneCount", label: "Сцен" },
  { id: "locations", label: "Объекты" },
  { id: "characters", label: "Персонажи" },
  { id: "planSeconds", label: "Хронометраж" },
  { id: "pageCount", label: "Страницы" },
  { id: "isNightShift", label: "Ночная смена" },
  { id: "comment", label: "Комментарий" },
];

const FULL_DEFAULT_IDS = [
  "dayNumber",
  "date",
  "sceneNumber",
  "location",
  "intExt",
  "dayNight",
  "characters",
  "planSeconds",
  "status",
] as const;

const SHORT_DEFAULT_IDS = [
  "dayNumber",
  "date",
  "sceneCount",
  "locations",
  "characters",
  "planSeconds",
] as const;

export function buildKppFullExportFields(
  resourceCategories: { id: string; name: string }[] = [],
): ExportFieldDef[] {
  return [
    ...KPP_FULL_BASE_FIELDS,
    ...resourceCategories.map((cat) => ({
      id: resourceColumnId(cat.id),
      label: cat.name,
    })),
  ];
}

export function buildKppShortExportFields(): ExportFieldDef[] {
  return [...KPP_SHORT_BASE_FIELDS];
}

function defaultsFromIds(
  ids: readonly string[],
  fields: ExportFieldDef[],
): ExportColumn[] {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return ids
    .map((id) => byId.get(id))
    .filter((f): f is ExportFieldDef => Boolean(f))
    .map((f) => ({
      id: f.id,
      title: f.label,
      fieldIds: [f.id],
    }));
}

export function createDefaultKppFullColumns(
  resourceCategories: { id: string; name: string }[] = [],
): ExportColumn[] {
  return defaultsFromIds(
    FULL_DEFAULT_IDS,
    buildKppFullExportFields(resourceCategories),
  );
}

export function createDefaultKppShortColumns(
  showWeekday: boolean,
): ExportColumn[] {
  const ids = showWeekday
    ? (["dayNumber", "date", "weekday", "sceneCount", "locations", "characters", "planSeconds"] as const)
    : SHORT_DEFAULT_IDS;
  return defaultsFromIds(ids, buildKppShortExportFields());
}

export function kppFieldLabelsMap(
  fields: ExportFieldDef[],
): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.id, f.label]));
}

export function isKppResourceField(fieldId: string) {
  return fieldId.startsWith(RESOURCE_COLUMN_PREFIX);
}

export { createExportColumnId, resourceColumnId };
