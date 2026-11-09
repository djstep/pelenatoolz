import { parseDateKey } from "@/features/actor-availability/lib/status";
import { formatDateShort } from "@/shared/i18n/format-date";

export type WhenSpan = {
  allDay: boolean;
  startKey: string;
  endKey: string;
  startTime: string | null;
  endTime: string | null;
};

function dayLabel(key: string): string {
  return formatDateShort(parseDateKey(key), { utc: true });
}

/** «10:00–11:00», «Весь день», у многодневного — с датами. */
export function eventWhenLabel(item: WhenSpan): string {
  if (item.allDay) {
    if (item.startKey === item.endKey) return "Весь день";
    return `${dayLabel(item.startKey)} – ${dayLabel(item.endKey)}`;
  }
  if (item.startKey === item.endKey) return `${item.startTime}–${item.endTime}`;
  return `${dayLabel(item.startKey)}, ${item.startTime} – ${dayLabel(item.endKey)}, ${item.endTime}`;
}

/** То же, но всегда с датой: для списка пересечений и выгрузки. */
export function eventDateTimeLabel(item: WhenSpan): string {
  if (item.startKey === item.endKey) {
    const time = item.allDay ? "весь день" : `${item.startTime}–${item.endTime}`;
    return `${dayLabel(item.startKey)}, ${time}`;
  }
  return item.allDay
    ? `${dayLabel(item.startKey)} – ${dayLabel(item.endKey)}`
    : `${dayLabel(item.startKey)}, ${item.startTime} – ${dayLabel(item.endKey)}, ${item.endTime}`;
}
