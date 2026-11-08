import Link from "next/link";
import {
  isPulled,
  PULLED_LABELS,
  type CalendarEvent,
  type CalendarItem,
  type PulledItem,
} from "@/features/prep-calendar/lib/calendar-types";
import { prepEventColorStyle } from "@/features/prep-calendar/lib/event-colors";
import { eventWhenLabel } from "@/features/prep-calendar/lib/calendar-format";
import { cn } from "@/shared/lib/cn";

export { eventWhenLabel } from "@/features/prep-calendar/lib/calendar-format";

/** Название места: объект из «Локаций» и уточнение текстом. */
export function eventPlaceLabel(event: CalendarEvent): string | null {
  return [event.locationName, event.locationText].filter(Boolean).join(", ") || null;
}

/** Подпись второй строки: тип своего события или откуда взята запись. */
export function itemKindLabel(item: CalendarItem): string {
  if (!isPulled(item)) return item.type.name;
  const label = PULLED_LABELS[item.source];
  return `${label.kind} · ${label.from}`;
}

/** Полное описание для чтения с экрана и подсказки: цвет сам по себе тип не называет. */
export function itemAccessibleLabel(item: CalendarItem): string {
  const place = isPulled(item) ? null : eventPlaceLabel(item);
  return [item.title, itemKindLabel(item), eventWhenLabel(item), place].filter(Boolean).join(", ");
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

/** Метка подтянутой записи: контур, без заливки цветом типа. */
export function PulledBadge({ item }: { item: PulledItem }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-[5px] border border-dashed border-[var(--border-strong)] px-1.5 py-px text-xs font-semibold text-[var(--fg-2)]">
      <span className="truncate">{itemKindLabel(item)}</span>
    </span>
  );
}

/** Вид подтянутой записи: пунктирный контур на фоне страницы — её нельзя спутать со своим событием. */
export const PULLED_CLASS =
  "border border-dashed border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)]";

function ChipLines({ item }: { item: CalendarItem }) {
  return (
    <>
      {/* Название первым: оно важнее. Тип или источник — словом во второй строке. */}
      <span className="block truncate font-semibold">
        {item.startTime ? <span className="tabular-nums">{item.startTime} </span> : null}
        {item.title}
      </span>
      <span className={cn("block truncate text-[11px]", isPulled(item) && "text-[var(--muted-fg)]")}>
        {itemKindLabel(item)}
      </span>
    </>
  );
}

const CHIP_CLASS = "block w-full min-w-0 rounded-[5px] px-1.5 py-0.5 text-left text-xs leading-4";

/** Строка в ячейке: своё событие открывает окно, подтянутая запись ведёт на источник. */
export function ItemChip({
  item,
  onOpen,
}: {
  item: CalendarItem;
  onOpen: (event: CalendarEvent) => void;
}) {
  if (isPulled(item)) {
    return (
      <Link
        href={item.href}
        title={itemAccessibleLabel(item)}
        aria-label={itemAccessibleLabel(item)}
        className={cn(CHIP_CLASS, PULLED_CLASS)}
        onClick={(click) => click.stopPropagation()}
      >
        <ChipLines item={item} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      title={itemAccessibleLabel(item)}
      aria-label={itemAccessibleLabel(item)}
      className={cn(CHIP_CLASS, "border")}
      style={prepEventColorStyle(item.type.color)}
      onClick={(click) => {
        click.stopPropagation();
        onOpen(item);
      }}
    >
      <ChipLines item={item} />
    </button>
  );
}
