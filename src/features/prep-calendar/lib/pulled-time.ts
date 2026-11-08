import { addDaysToKey } from "@/features/prep-calendar/lib/calendar-view";

/** План проб хранит только начало: в календаре он длится час, как клетка планировщика. */
export const AUDITION_SLOT_MINUTES = 60;

/**
 * Время из источника: «9:30», «09.30» и «09:30» → «09:30». Время пробы вводят свободным
 * текстом, поэтому всё остальное («после обеда») — не время, запись идёт на весь день.
 */
export function normalizeSourceTime(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Конец через `minutes` минут; после полуночи — на следующий день. */
export function plusMinutes(
  dateKey: string,
  time: string,
  minutes: number,
): { endKey: string; endTime: string } {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour! * 60 + minute! + minutes;
  const days = Math.floor(total / 1440);
  const rest = total % 1440;
  return {
    endKey: addDaysToKey(dateKey, days),
    endTime: `${String(Math.floor(rest / 60)).padStart(2, "0")}:${String(rest % 60).padStart(2, "0")}`,
  };
}
