import { addDaysToKey } from "@/features/prep-calendar/lib/calendar-view";
import { isDateKey } from "@/features/prep-calendar/lib/event-dates";
import { zonedTimeToUtc } from "@/features/prep-calendar/lib/zoned-time";

/**
 * Время записи журнала по поясу проекта: «09.11.2026, 16:12:32». Считается на сервере и уходит
 * в браузер готовой строкой — сервер (UTC) и браузер (Москва) иначе писали бы его по-разному.
 */
export function formatAuditTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * Фильтр «с … по …» журнала: дни по поясу проекта, «по» включает весь день. Неверная дата —
 * без этого края, а не ошибка запроса.
 */
export function auditDateBounds(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  timeZone: string,
): { gte?: Date; lt?: Date } {
  const bounds: { gte?: Date; lt?: Date } = {};
  if (dateFrom && isDateKey(dateFrom)) bounds.gte = zonedTimeToUtc(dateFrom, "00:00", timeZone);
  if (dateTo && isDateKey(dateTo)) bounds.lt = zonedTimeToUtc(addDaysToKey(dateTo, 1), "00:00", timeZone);
  return bounds;
}
