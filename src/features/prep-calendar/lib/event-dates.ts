import { parseDateKey, toDateKey } from "@/features/actor-availability/lib/status";

/** Что нужно сохранить: либо день начала и конца, либо два момента времени. Не смешивать. */
export type PrepEventRange =
  | { allDay: true; startDate: string; endDate: string }
  | { allDay: false; startAt: Date; endAt: Date };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Настоящая дата «ГГГГ-ММ-ДД»: 2026-02-30 не проходит. */
function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  return toDateKey(parseDateKey(value)) === value;
}

/** Текст ошибки или null. Окончание равно началу — можно. */
export function prepEventRangeError(range: PrepEventRange): string | null {
  if (range.allDay) {
    if (!isDateKey(range.startDate) || !isDateKey(range.endDate)) return "Укажите даты";
    return range.endDate < range.startDate ? "Окончание раньше начала" : null;
  }
  if (Number.isNaN(range.startAt.getTime()) || Number.isNaN(range.endAt.getTime())) {
    return "Укажите дату и время";
  }
  return range.endAt < range.startAt ? "Окончание раньше начала" : null;
}

/**
 * Столбцы таблицы. Вторая пара всегда пустая. Даты идут через `parseDateKey` (полночь UTC):
 * `parseDateInput` на сервере с поясом восточнее UTC записал бы в `@db.Date` прошлый день.
 */
export function prepEventRangeColumns(range: PrepEventRange) {
  if (range.allDay) {
    return {
      allDay: true,
      startDate: parseDateKey(range.startDate),
      endDate: parseDateKey(range.endDate),
      startAt: null,
      endAt: null,
    };
  }
  return {
    allDay: false,
    startDate: null,
    endDate: null,
    startAt: range.startAt,
    endAt: range.endAt,
  };
}
