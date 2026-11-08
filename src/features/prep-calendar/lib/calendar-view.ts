import {
  addDays,
  parseDateKey,
  startOfWeekMonday,
  toDateKey,
} from "@/features/actor-availability/lib/status";
import { isDateKey } from "@/features/prep-calendar/lib/event-dates";

export const CALENDAR_VIEWS = ["month", "week", "list"] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  month: "Месяц",
  week: "Неделя",
  list: "Список",
};

export type DateRange = { from: string; to: string };

/** Вид из адреса. Неизвестный или отсутствующий — null, вид выбирает экран. */
export function parseCalendarView(value: unknown): CalendarView | null {
  return CALENDAR_VIEWS.find((view) => view === value) ?? null;
}

/** Дата из адреса. Мусор и годы вне разумного предела — запасная дата, не ошибка. */
export function parseCalendarDate(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !isDateKey(value)) return fallback;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100 ? value : fallback;
}

export function addDaysToKey(key: string, days: number): string {
  return toDateKey(addDays(parseDateKey(key), days));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Сдвиг на месяцы. 31 января + 1 месяц = последний день февраля. */
export function addMonthsToKey(key: string, months: number): string {
  const date = parseDateKey(key);
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const day = Math.min(
    date.getUTCDate(),
    daysInMonth(first.getUTCFullYear(), first.getUTCMonth()),
  );
  return toDateKey(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)));
}

function monthRange(key: string): DateRange {
  const date = parseDateKey(key);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    from: toDateKey(new Date(Date.UTC(year, month, 1))),
    to: toDateKey(new Date(Date.UTC(year, month, daysInMonth(year, month)))),
  };
}

function weekRange(key: string): DateRange {
  const monday = startOfWeekMonday(parseDateKey(key));
  return { from: toDateKey(monday), to: toDateKey(addDays(monday, 6)) };
}

/** Какие дни видны на экране: месяц — полными неделями, список — ровно месяц. */
export function visibleRange(view: CalendarView, date: string): DateRange {
  if (view === "week") return weekRange(date);
  const month = monthRange(date);
  if (view === "list") return month;
  return { from: weekRange(month.from).from, to: weekRange(month.to).to };
}

/** Дата для «вперёд» и «назад»: на неделю в недельном виде, иначе на месяц. */
export function stepDate(view: CalendarView, date: string, direction: 1 | -1): string {
  return view === "week" ? addDaysToKey(date, 7 * direction) : addMonthsToKey(date, direction);
}

export function eachDayKey({ from, to }: DateRange): string[] {
  const days: string[] = [];
  for (let key = from; key <= to; key = addDaysToKey(key, 1)) days.push(key);
  return days;
}

/** Адрес экрана: вид и дата хранятся в нём, чтобы ссылкой можно было поделиться. */
export function calendarHref(basePath: string, view: CalendarView, date: string): string {
  return `${basePath}?${new URLSearchParams({ view, date })}`;
}
