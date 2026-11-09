import { parseDateKey } from "@/features/actor-availability/lib/status";
import type { ExportColumn, ExportFieldDef } from "@/features/exports/types";
import { compareInDay } from "@/features/prep-calendar/lib/calendar-layout";
import {
  isPulled,
  PULLED_LABELS,
  type CalendarItem,
} from "@/features/prep-calendar/lib/calendar-types";
import { formatDateShort } from "@/shared/i18n/format-date";
import { countOf } from "@/shared/lib/plural";

export const CALENDAR_EXPORT_LAYOUT_KEY = "prepCalendar";

/** Поля выгрузки. Прав на отдельные поля нет: что не положено зрителю, не приходит в строки. */
export const CALENDAR_EXPORT_FIELDS: readonly ExportFieldDef[] = [
  { id: "date", label: "Дата" },
  { id: "time", label: "Время" },
  { id: "title", label: "Название" },
  { id: "kind", label: "Тип / источник" },
  { id: "place", label: "Место" },
  { id: "people", label: "Участники" },
  { id: "departments", label: "Цеха" },
  { id: "note", label: "Заметка" },
];

const FIELD_IDS = new Set(CALENDAR_EXPORT_FIELDS.map((field) => field.id));
const FIELD_SEPARATOR = " · ";

export function calendarDefaultExportColumns(): ExportColumn[] {
  return CALENDAR_EXPORT_FIELDS.map(({ id, label }) => ({ id, title: label, fieldIds: [id] }));
}

/** Колонки из запроса или раскладки: неизвестные поля выбрасываются, пустые колонки тоже. */
export function calendarExportColumns(columns: ExportColumn[]): ExportColumn[] {
  return columns
    .map(({ id, title, fieldIds }) => ({
      id,
      title,
      fieldIds: fieldIds.filter((fieldId) => FIELD_IDS.has(fieldId)),
    }))
    .filter((column) => column.fieldIds.length > 0);
}

/** В печати дата — заголовок дня, отдельная колонка её только повторяла бы. */
export function calendarPrintColumns(columns: ExportColumn[]): ExportColumn[] {
  const printed = columns
    .map((column) => ({ ...column, fieldIds: column.fieldIds.filter((id) => id !== "date") }))
    .filter((column) => column.fieldIds.length > 0);
  return printed.length > 0 ? printed : columns;
}

function dayLabel(key: string): string {
  return formatDateShort(parseDateKey(key), { utc: true });
}

function fieldValue(item: CalendarItem, fieldId: string): string {
  switch (fieldId) {
    case "date":
      return item.startKey === item.endKey
        ? dayLabel(item.startKey)
        : `${dayLabel(item.startKey)} – ${dayLabel(item.endKey)}`;
    case "time":
      if (item.allDay) return "весь день";
      return item.startKey === item.endKey
        ? `${item.startTime}–${item.endTime}`
        : `${item.startTime} – ${item.endTime} (${dayLabel(item.endKey)})`;
    case "title":
      return item.title;
    case "kind":
      if (!isPulled(item)) return item.type.name;
      return `${PULLED_LABELS[item.source].kind} (${PULLED_LABELS[item.source].from})`;
    case "place":
      return isPulled(item)
        ? ""
        : [item.locationName, item.locationText].filter(Boolean).join(", ");
    case "people": {
      if (isPulled(item)) return item.people.join(", ");
      const names = item.participants.map((person) => person.label);
      if (item.hiddenCandidates > 0) {
        names.push(`+${countOf(item.hiddenCandidates, ["кандидат", "кандидата", "кандидатов"])}`);
      }
      return names.join(", ");
    }
    case "departments":
      return isPulled(item) ? "" : item.departments.map((department) => department.name).join(", ");
    case "note":
      return item.note ?? "";
    default:
      return "";
  }
}

/** Текст ячейки: значения полей колонки, пустые пропускаются. */
export function calendarExportCell(item: CalendarItem, column: ExportColumn): string {
  return column.fieldIds
    .map((fieldId) => fieldValue(item, fieldId))
    .filter(Boolean)
    .join(FIELD_SEPARATOR);
}

/** Строки по порядку: день начала, затем «весь день», затем по времени. Многодневное — одной строкой. */
export function sortCalendarItems(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort((a, b) => a.startKey.localeCompare(b.startKey) || compareInDay(a, b));
}

export type CalendarDayGroup = { day: string; title: string; items: CalendarItem[] };

/** Для печати: группы по дню начала. Пустых дней нет. */
export function groupCalendarItemsByDay(items: CalendarItem[]): CalendarDayGroup[] {
  const groups: CalendarDayGroup[] = [];
  for (const item of sortCalendarItems(items)) {
    const last = groups[groups.length - 1];
    if (last?.day === item.startKey) last.items.push(item);
    else {
      const title = new Intl.DateTimeFormat("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(parseDateKey(item.startKey));
      groups.push({
        day: item.startKey,
        title: title[0]!.toLocaleUpperCase("ru") + title.slice(1),
        items: [item],
      });
    }
  }
  return groups;
}
