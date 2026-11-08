"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { EventChip } from "@/features/prep-calendar/components/event-chip";
import { compareInDay, eventsByDay } from "@/features/prep-calendar/lib/calendar-layout";
import type {
  CalendarEvent,
  NewEventPreset,
} from "@/features/prep-calendar/lib/calendar-types";
import { calendarHref, eachDayKey, type DateRange } from "@/features/prep-calendar/lib/calendar-view";
import { cn } from "@/shared/lib/cn";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MAX_IN_CELL = 3;

export function CalendarMonthView({
  basePath,
  range,
  month,
  today,
  events,
  canWrite,
  onOpen,
  onCreate,
}: {
  basePath: string;
  range: DateRange;
  /** «ГГГГ-ММ» показанного месяца: дни соседних приглушены. */
  month: string;
  today: string;
  events: CalendarEvent[];
  canWrite: boolean;
  onOpen: (event: CalendarEvent) => void;
  onCreate: (preset: NewEventPreset) => void;
}) {
  const router = useRouter();
  const days = eachDayKey(range);
  const byDay = eventsByDay(events, days);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--surface-2)]">
        {WEEKDAYS.map((name) => (
          <div key={name} className="px-2 py-1.5 text-xs font-semibold text-[var(--muted-fg)]">
            {name}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const list = [...(byDay.get(day) ?? [])].sort(compareInDay);
          const shown = list.slice(0, MAX_IN_CELL);
          const hidden = list.length - shown.length;
          const weekHref = calendarHref(basePath, "week", day);
          const dayNumber = Number(day.slice(8));
          return (
            <div
              key={day}
              data-day={day}
              className={cn(
                "group flex min-h-[132px] min-w-0 cursor-pointer flex-col gap-0.5 border-[var(--border)] p-1",
                index % 7 !== 6 && "border-r",
                index < days.length - 7 && "border-b",
                !day.startsWith(month) && "bg-[var(--surface-2)]",
              )}
              onClick={() => {
                // Пустой день — новое событие, день с событиями — его неделя.
                if (list.length === 0 && canWrite) onCreate({ dateKey: day, allDay: true });
                else router.push(weekHref);
              }}
            >
              <div className="flex items-center justify-between">
                <Link
                  href={weekHref}
                  aria-label={`Неделя с ${day}`}
                  onClick={(click) => click.stopPropagation()}
                  className={cn(
                    "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold tabular-nums",
                    day === today
                      ? "bg-[var(--primary)] text-[var(--primary-fg)]"
                      : day.startsWith(month)
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted-fg)]",
                  )}
                >
                  {dayNumber}
                </Link>
                {canWrite ? (
                  <button
                    type="button"
                    aria-label={`Создать событие ${day}`}
                    className="h-6 w-6 rounded-md text-sm text-[var(--muted-fg)] opacity-0 hover:bg-[var(--surface-3)] focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={(click) => {
                      click.stopPropagation();
                      onCreate({ dateKey: day, allDay: true });
                    }}
                  >
                    +
                  </button>
                ) : null}
              </div>
              {shown.map((event) => (
                <EventChip key={event.id} event={event} onOpen={onOpen} />
              ))}
              {hidden > 0 ? (
                <Link
                  href={weekHref}
                  onClick={(click) => click.stopPropagation()}
                  className="px-1 text-xs font-medium text-[var(--accent)]"
                >
                  ещё {hidden}
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
