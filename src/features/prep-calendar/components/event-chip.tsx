import type { CalendarEvent } from "@/features/prep-calendar/lib/calendar-types";
import { prepEventColorStyle } from "@/features/prep-calendar/lib/event-colors";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { parseDateKey } from "@/features/actor-availability/lib/status";

function dayLabel(key: string): string {
  return formatDateShort(parseDateKey(key), { utc: true });
}

/** «10:00–11:00», «весь день», у многодневного — с датами. */
export function eventWhenLabel(event: CalendarEvent): string {
  if (event.allDay) {
    if (event.startKey === event.endKey) return "Весь день";
    return `${dayLabel(event.startKey)} – ${dayLabel(event.endKey)}`;
  }
  if (event.startKey === event.endKey) return `${event.startTime}–${event.endTime}`;
  return `${dayLabel(event.startKey)}, ${event.startTime} – ${dayLabel(event.endKey)}, ${event.endTime}`;
}

/** Название места: объект из «Локаций» и уточнение текстом. */
export function eventPlaceLabel(event: CalendarEvent): string | null {
  return [event.locationName, event.locationText].filter(Boolean).join(", ") || null;
}

/** Полное описание для чтения с экрана и подсказки: цвет сам по себе тип не называет. */
export function eventAccessibleLabel(event: CalendarEvent): string {
  return [event.title, event.type.name, eventWhenLabel(event), eventPlaceLabel(event)]
    .filter(Boolean)
    .join(", ");
}

export function EventTypeBadge({ type }: { type: CalendarEvent["type"] }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-[5px] border px-1.5 py-px text-xs font-semibold"
      style={prepEventColorStyle(type.color)}
    >
      <span className="truncate">{type.name}</span>
    </span>
  );
}

/** Строка события в ячейке: тип словом рядом с названием, время — если есть. */
export function EventChip({
  event,
  onOpen,
  className,
}: {
  event: CalendarEvent;
  onOpen: (event: CalendarEvent) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={eventAccessibleLabel(event)}
      aria-label={eventAccessibleLabel(event)}
      className={cn(
        "block w-full min-w-0 rounded-[5px] border px-1.5 py-0.5 text-left text-xs leading-4",
        className,
      )}
      style={prepEventColorStyle(event.type.color)}
      onClick={(click) => {
        click.stopPropagation();
        onOpen(event);
      }}
    >
      {/* Название первым: оно важнее. Тип — словом во второй строке, не только цветом. */}
      <span className="block truncate font-semibold">
        {event.startTime ? <span className="tabular-nums">{event.startTime} </span> : null}
        {event.title}
      </span>
      <span className="block truncate text-[11px]">{event.type.name}</span>
    </button>
  );
}
