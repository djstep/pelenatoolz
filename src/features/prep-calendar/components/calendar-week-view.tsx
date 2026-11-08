"use client";

import { useEffect, useRef } from "react";
import { parseDateKey } from "@/features/actor-availability/lib/status";
import Link from "next/link";
import {
  eventPlaceLabel,
  ItemChip,
  itemAccessibleLabel,
  itemKindLabel,
  PULLED_CLASS,
} from "@/features/prep-calendar/components/event-chip";
import {
  eventsByDay,
  MIN_BLOCK_MINUTES,
  MINUTES_IN_DAY,
  placeInColumns,
  segmentForDay,
} from "@/features/prep-calendar/lib/calendar-layout";
import type {
  CalendarEvent,
  CalendarItem,
  NewEventPreset,
} from "@/features/prep-calendar/lib/calendar-types";
import { isPulled } from "@/features/prep-calendar/lib/calendar-types";
import { eachDayKey, type DateRange } from "@/features/prep-calendar/lib/calendar-view";
import { prepEventColorStyle } from "@/features/prep-calendar/lib/event-colors";
import { formatCalendarColumnHeader } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";

const HOUR_PX = 48;
const DAY_PX = HOUR_PX * 24;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const COLUMNS = "grid-cols-[52px_repeat(7,minmax(92px,1fr))]";
/** С этого часа открывается сетка, если раньше событий нет. */
const DEFAULT_SCROLL_HOUR = 8;

const toPx = (minutes: number) => (minutes / 60) * HOUR_PX;

function TimedBlock({
  item,
  startMin,
  endMin,
  column,
  columns,
  onOpen,
}: {
  item: CalendarItem;
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
  onOpen: (event: CalendarEvent) => void;
}) {
  const height = Math.max(
    toPx(Math.min(endMin, MINUTES_IN_DAY) - startMin),
    toPx(MIN_BLOCK_MINUTES),
  );
  const box = {
    top: toPx(startMin),
    height: Math.min(height, DAY_PX - toPx(startMin)),
    left: `${(column / columns) * 100}%`,
    width: `calc(${100 / columns}% - 2px)`,
  };
  const blockClass =
    "absolute overflow-hidden rounded-[5px] px-1.5 py-0.5 text-left text-xs leading-[15px]";
  const lines = (
    <>
      <span className="block truncate font-semibold">{item.title}</span>
      <span className={cn("block truncate", isPulled(item) && "text-[var(--muted-fg)]")}>
        {itemKindLabel(item)}
      </span>
      {!isPulled(item) && eventPlaceLabel(item) ? (
        <span className="block truncate">{eventPlaceLabel(item)}</span>
      ) : null}
    </>
  );
  if (isPulled(item)) {
    return (
      <Link
        href={item.href}
        title={itemAccessibleLabel(item)}
        aria-label={itemAccessibleLabel(item)}
        className={cn(blockClass, PULLED_CLASS)}
        style={box}
        onClick={(click) => click.stopPropagation()}
      >
        {lines}
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={itemAccessibleLabel(item)}
      aria-label={itemAccessibleLabel(item)}
      className={cn(blockClass, "border")}
      style={{ ...prepEventColorStyle(item.type.color), ...box }}
      onClick={(click) => {
        click.stopPropagation();
        onOpen(item);
      }}
    >
      {lines}
    </button>
  );
}

export function CalendarWeekView({
  range,
  today,
  items,
  canWrite,
  onOpen,
  onCreate,
}: {
  range: DateRange;
  today: string;
  items: CalendarItem[];
  canWrite: boolean;
  onOpen: (event: CalendarEvent) => void;
  onCreate: (preset: NewEventPreset) => void;
}) {
  const days = eachDayKey(range);
  const allDay = eventsByDay(items.filter((item) => item.allDay), days);
  const timed = eventsByDay(items.filter((item) => !item.allDay), days);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const placedByDay = days.map((day) =>
    placeInColumns(
      (timed.get(day) ?? []).map((item) => ({ item, ...segmentForDay(item, day) })),
    ),
  );
  const earliest = Math.min(
    DEFAULT_SCROLL_HOUR * 60,
    ...placedByDay.flat().map((entry) => entry.startMin),
  );

  // Открываем на рабочих часах. Шапка закреплена, поэтому прокрутка считается от начала сетки.
  useEffect(() => {
    // Отступ — чтобы подпись часа не ушла под шапку.
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, toPx(earliest) - 10);
    // Только при смене недели: иначе сохранение события сбивало бы прокрутку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from]);

  return (
    <div
      ref={scrollRef}
      className="max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]"
    >
      <div className="min-w-[696px]">
        <div
          className={cn(
            "sticky top-0 z-20 grid border-b border-[var(--border)] bg-[var(--surface-2)]",
            COLUMNS,
          )}
        >
          <div />
          {days.map((day) => {
            const header = formatCalendarColumnHeader(parseDateKey(day), { utc: true });
            return (
              <div
                key={day}
                className={cn(
                  "border-l border-[var(--border)] px-2 py-1.5 text-xs",
                  day === today ? "font-bold text-[var(--foreground)]" : "text-[var(--muted-fg)]",
                )}
              >
                <span className="font-semibold">{header.weekday}</span>{" "}
                <span className="tabular-nums">{Number(day.slice(8))}</span>
                {day === today ? <span className="ml-1 font-semibold">сегодня</span> : null}
              </div>
            );
          })}
          <div className="px-1 py-1 text-[11px] leading-tight text-[var(--muted-fg)]">Весь день</div>
          {days.map((day) => (
            <div
              key={day}
              data-allday={day}
              className={cn(
                "flex min-h-8 min-w-0 flex-col gap-0.5 border-l border-[var(--border)] p-0.5",
                canWrite && "cursor-pointer",
              )}
              onClick={() => {
                if (canWrite) onCreate({ dateKey: day, allDay: true });
              }}
            >
              {(allDay.get(day) ?? []).map((item) => (
                <ItemChip key={item.id} item={item} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>

        <div ref={gridRef} className={cn("grid", COLUMNS)}>
          <div className="relative" style={{ height: DAY_PX }}>
            {HOURS.map((hour) => (
              <span
                key={hour}
                className="absolute right-1.5 text-[11px] tabular-nums leading-none text-[var(--muted-fg)]"
                style={{ top: hour === 0 ? 2 : hour * HOUR_PX - 5 }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((day, index) => (
            <div
              key={day}
              data-hours={day}
              className={cn(
                "relative border-l border-[var(--border)]",
                canWrite && "cursor-pointer",
              )}
              style={{
                height: DAY_PX,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
              }}
              onClick={(click) => {
                if (!canWrite) return;
                const box = click.currentTarget.getBoundingClientRect();
                const hour = Math.min(23, Math.floor((click.clientY - box.top) / HOUR_PX));
                onCreate({
                  dateKey: day,
                  allDay: false,
                  time: `${String(hour).padStart(2, "0")}:00`,
                });
              }}
            >
              {placedByDay[index]!.map((entry) => (
                <TimedBlock
                  key={entry.item.id}
                  item={entry.item}
                  startMin={entry.startMin}
                  endMin={entry.endMin}
                  column={entry.column}
                  columns={entry.columns}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
