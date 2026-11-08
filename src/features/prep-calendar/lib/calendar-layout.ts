import { addDaysToKey, eachDayKey } from "@/features/prep-calendar/lib/calendar-view";

/** Что нужно раскладке от события. */
export type SpanEvent = {
  allDay: boolean;
  startKey: string;
  endKey: string;
  startTime: string | null;
  endTime: string | null;
};

export const MINUTES_IN_DAY = 24 * 60;

/** Короткое событие занимает на сетке не меньше этого: иначе в нём не поместится текст. */
export const MIN_BLOCK_MINUTES = 30;

function toMinutes(time: string | null): number {
  if (!time) return 0;
  const [hour, minute] = time.split(":").map(Number);
  return hour! * 60 + minute!;
}

/** Последний день события. Окончание ровно в полночь следующий день не занимает. */
function lastDayKey(event: SpanEvent): string {
  if (!event.allDay && event.endTime === "00:00" && event.endKey > event.startKey) {
    return addDaysToKey(event.endKey, -1);
  }
  return event.endKey;
}

export function eventDayKeys(event: SpanEvent): string[] {
  return eachDayKey({ from: event.startKey, to: lastDayKey(event) });
}

/** Часть события со временем, попавшая в этот день, в минутах от полуночи. */
export function segmentForDay(
  event: SpanEvent,
  dayKey: string,
): { startMin: number; endMin: number } {
  const startMin = dayKey === event.startKey ? toMinutes(event.startTime) : 0;
  const endMin =
    dayKey === event.endKey && event.endTime !== "00:00"
      ? toMinutes(event.endTime)
      : dayKey === event.endKey && dayKey === event.startKey
        ? startMin
        : MINUTES_IN_DAY;
  return { startMin, endMin };
}

/** События по дням: многодневное попадает в каждый свой день, вне списка дней не попадает. */
export function eventsByDay<T extends SpanEvent>(events: T[], days: string[]): Map<string, T[]> {
  const result = new Map<string, T[]>(days.map((day) => [day, []]));
  for (const event of events) {
    for (const key of eventDayKeys(event)) result.get(key)?.push(event);
  }
  return result;
}

/** Порядок в дне: сначала весь день, затем по времени начала, при равенстве — как пришли. */
export function compareInDay(a: SpanEvent, b: SpanEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (a.startTime ?? "").localeCompare(b.startTime ?? "");
}

export type Placed<T> = {
  item: T;
  startMin: number;
  endMin: number;
  /** Номер полосы и сколько полос в группе пересекающихся событий. */
  column: number;
  columns: number;
};

/**
 * Раскладка дня недели: пересекающиеся события стоят рядом, каждое в своей полосе. Группа —
 * цепочка событий, связанных пересечениями: все её события получают одну ширину.
 */
export function placeInColumns<T>(
  segments: { item: T; startMin: number; endMin: number }[],
): Placed<T>[] {
  const visualEnd = (s: { startMin: number; endMin: number }) =>
    Math.max(s.endMin, s.startMin + MIN_BLOCK_MINUTES);
  const sorted = [...segments].sort(
    (a, b) => a.startMin - b.startMin || visualEnd(b) - visualEnd(a),
  );

  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -1;
  let columnEnds: number[] = [];

  const closeGroup = () => {
    for (const entry of group) entry.columns = columnEnds.length;
    group = [];
    columnEnds = [];
  };

  for (const segment of sorted) {
    if (group.length > 0 && segment.startMin >= groupEnd) closeGroup();
    const free = columnEnds.findIndex((end) => end <= segment.startMin);
    const column = free === -1 ? columnEnds.length : free;
    columnEnds[column] = visualEnd(segment);
    groupEnd = group.length > 0 ? Math.max(groupEnd, visualEnd(segment)) : visualEnd(segment);
    const entry = { ...segment, column, columns: 1 };
    group.push(entry);
    placed.push(entry);
  }
  closeGroup();
  return placed;
}
