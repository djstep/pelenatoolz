"use client";

import { parseDateKey } from "@/features/actor-availability/lib/status";
import {
  eventAccessibleLabel,
  eventPlaceLabel,
  eventWhenLabel,
  EventTypeBadge,
} from "@/features/prep-calendar/components/event-chip";
import { compareInDay, eventsByDay } from "@/features/prep-calendar/lib/calendar-layout";
import type {
  CalendarEvent,
  NewEventPreset,
} from "@/features/prep-calendar/lib/calendar-types";
import { eachDayKey, type DateRange } from "@/features/prep-calendar/lib/calendar-view";
import { formatDateLong, formatDateRange, formatDateShort } from "@/shared/i18n/format-date";
import { countOf } from "@/shared/lib/plural";
import { Button } from "@/shared/ui/button";

type Row =
  | { kind: "day"; day: string; events: CalendarEvent[] }
  | { kind: "empty"; from: string; to: string };

/** Дни с событиями идут строками, идущие подряд пустые дни сворачиваются в одну. */
function buildRows(days: string[], byDay: Map<string, CalendarEvent[]>): Row[] {
  const rows: Row[] = [];
  for (const day of days) {
    const events = byDay.get(day) ?? [];
    const last = rows[rows.length - 1];
    if (events.length > 0) rows.push({ kind: "day", day, events: [...events].sort(compareInDay) });
    else if (last?.kind === "empty") last.to = day;
    else rows.push({ kind: "empty", from: day, to: day });
  }
  return rows;
}

function emptyLabel(from: string, to: string): string {
  const a = parseDateKey(from);
  if (from === to) return `${formatDateShort(a, { utc: true })}: событий нет`;
  return `${formatDateRange(a, parseDateKey(to), { utc: true })}: событий нет`;
}

/** «Пятница, 4 декабря 2026 г.» — заглавная только первая буква. */
function dayTitle(day: string): string {
  const text = formatDateLong(`${day}T12:00:00`);
  return text[0]!.toLocaleUpperCase("ru") + text.slice(1);
}

function peopleLine(event: CalendarEvent): string | null {
  const names = event.participants.map((person) => person.label);
  if (event.hiddenCandidates > 0) {
    names.push(`+${countOf(event.hiddenCandidates, ["кандидат", "кандидата", "кандидатов"])}`);
  }
  return names.length > 0 ? names.join(", ") : null;
}

function ListEvent({
  event,
  onOpen,
}: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
}) {
  const place = eventPlaceLabel(event);
  const people = peopleLine(event);
  return (
    <li>
      <button
        type="button"
        aria-label={eventAccessibleLabel(event)}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-[var(--glass-table-hover)] sm:flex-nowrap"
        onClick={() => onOpen(event)}
      >
        <span className="w-full shrink-0 text-sm tabular-nums text-[var(--fg-2)] sm:w-44">
          {eventWhenLabel(event)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <EventTypeBadge type={event.type} />
            <span className="min-w-0 break-words text-sm font-semibold">{event.title}</span>
          </span>
          {place ? (
            <span className="mt-0.5 block text-xs text-[var(--muted-fg)]">{place}</span>
          ) : null}
          {people ? (
            <span className="mt-0.5 block text-xs text-[var(--muted-fg)]">{people}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function CalendarListView({
  range,
  today,
  events,
  canWrite,
  onOpen,
  onCreate,
}: {
  range: DateRange;
  today: string;
  events: CalendarEvent[];
  canWrite: boolean;
  onOpen: (event: CalendarEvent) => void;
  onCreate: (preset: NewEventPreset) => void;
}) {
  const days = eachDayKey(range);
  const rows = buildRows(days, eventsByDay(events, days));

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      {rows.map((row) =>
        row.kind === "day" ? (
          <section key={row.day} className="border-b border-[var(--border)] last:border-b-0">
            <h3 className="bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-fg)]">
              {dayTitle(row.day)}
              {row.day === today ? " · сегодня" : ""}
            </h3>
            <ul className="divide-y divide-[var(--border)]">
              {row.events.map((event) => (
                <ListEvent key={event.id} event={event} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ) : (
          <div
            key={row.from}
            className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-1.5 last:border-b-0"
          >
            <span className="text-xs text-[var(--muted-fg)]">{emptyLabel(row.from, row.to)}</span>
            {canWrite ? (
              <Button
                type="button"
                variant="ghost"
                className="!h-7 !px-2 text-xs"
                aria-label={`Создать событие ${row.from}`}
                onClick={() => onCreate({ dateKey: row.from, allDay: true })}
              >
                + Событие
              </Button>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}
