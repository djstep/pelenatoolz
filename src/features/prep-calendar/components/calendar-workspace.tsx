"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { parseDateKey } from "@/features/actor-availability/lib/status";
import { CalendarListView } from "@/features/prep-calendar/components/calendar-list-view";
import { CalendarMonthView } from "@/features/prep-calendar/components/calendar-month-view";
import { CalendarWeekView } from "@/features/prep-calendar/components/calendar-week-view";
import { EventModal } from "@/features/prep-calendar/components/event-modal";
import type {
  CalendarEvent,
  CalendarItem,
  CalendarOptions,
  NewEventPreset,
  PulledSources,
} from "@/features/prep-calendar/lib/calendar-types";
import {
  CALENDAR_VIEW_LABELS,
  CALENDAR_VIEWS,
  calendarHref,
  stepDate,
  type CalendarView,
  type DateRange,
} from "@/features/prep-calendar/lib/calendar-view";
import { formatDateRange } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { SegmentLinks } from "@/shared/ui/segment-control";

const PHONE_QUERY = "(max-width: 767px)";

const MONTH_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function periodTitle(view: CalendarView, date: string, range: DateRange): string {
  if (view === "week") {
    return formatDateRange(parseDateKey(range.from), parseDateKey(range.to), { utc: true });
  }
  const title = MONTH_FORMAT.format(parseDateKey(date)).replace(/\s*г\.$/, "");
  return title[0]!.toLocaleUpperCase("ru") + title.slice(1);
}

type ModalTarget = { event: CalendarEvent } | { preset: NewEventPreset };

export function CalendarWorkspace({
  projectId,
  basePath,
  view,
  viewFromAddress,
  date,
  today,
  range,
  timezone,
  items,
  sources,
  query,
  options,
}: {
  projectId: string;
  basePath: string;
  view: CalendarView;
  /** Вид указан в адресе: ссылке доверяем и на телефоне. */
  viewFromAddress: boolean;
  date: string;
  today: string;
  range: DateRange;
  timezone: string;
  /** Свои события и подтянутые записи вместе. */
  items: CalendarItem[];
  sources: PulledSources;
  /** Параметры адреса кроме вида и даты: переходы их сохраняют. */
  query: Record<string, string>;
  /** Варианты для окна события; нет права правки — null. */
  options: CalendarOptions | null;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<ModalTarget | null>(null);
  const canWrite = options !== null;

  // Сетка месяца на телефоне нечитаема: без явного вида в адресе открываем список.
  useEffect(() => {
    if (!viewFromAddress && window.matchMedia(PHONE_QUERY).matches) {
      router.replace(calendarHref(basePath, "list", date, query));
    }
  }, [basePath, date, query, router, viewFromAddress]);

  const openEvent = (event: CalendarEvent) => setTarget({ event });

  /** Переключатель источника: выключенный хранится в адресе как «0». */
  const toggleSource = (key: keyof PulledSources, shown: boolean) => {
    const next = { ...query };
    if (shown) delete next[key];
    else next[key] = "0";
    router.push(calendarHref(basePath, view, date, next));
  };
  const toggles = (
    [
      ["auditions", "Пробы"],
      ["kpp", "Подготовительные дни КПП"],
    ] as const
  ).filter(([key]) => sources[key] !== null);
  const create = (preset: NewEventPreset) => setTarget({ preset });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentLinks
          label="Вид календаря"
          activeHref={calendarHref(basePath, view, date, query)}
          items={CALENDAR_VIEWS.map((item) => ({
            href: calendarHref(basePath, item, date, query),
            label: CALENDAR_VIEW_LABELS[item],
          }))}
        />
        <div className="flex items-center gap-1">
          <Link
            href={calendarHref(basePath, view, stepDate(view, date, -1), query)}
            aria-label="Назад"
            className="glass-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)]"
          >
            <ChevronLeft size={16} aria-hidden />
          </Link>
          <Link
            href={calendarHref(basePath, view, today, query)}
            className="glass-btn-secondary inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-3 text-sm font-semibold"
          >
            Сегодня
          </Link>
          <Link
            href={calendarHref(basePath, view, stepDate(view, date, 1), query)}
            aria-label="Вперёд"
            className="glass-btn-secondary inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)]"
          >
            <ChevronRight size={16} aria-hidden />
          </Link>
        </div>
        <h3 className="text-[15px] font-bold" data-testid="calendar-period">
          {periodTitle(view, date, range)}
        </h3>
        {canWrite ? (
          <Button
            type="button"
            className="ml-auto"
            onClick={() => create({ dateKey: date, allDay: false })}
          >
            + Событие
          </Button>
        ) : null}
      </div>

      {toggles.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs font-semibold text-[var(--muted-fg)]">Показывать:</span>
          {toggles.map(([key, label]) => (
            <Checkbox
              key={key}
              label={label}
              checked={sources[key] === true}
              onChange={(change) => toggleSource(key, change.target.checked)}
            />
          ))}
        </div>
      ) : null}

      {view === "month" ? (
        <CalendarMonthView
          basePath={basePath}
          range={range}
          month={date.slice(0, 7)}
          query={query}
          today={today}
          items={items}
          canWrite={canWrite}
          onOpen={openEvent}
          onCreate={create}
        />
      ) : view === "week" ? (
        <CalendarWeekView
          range={range}
          today={today}
          items={items}
          canWrite={canWrite}
          onOpen={openEvent}
          onCreate={create}
        />
      ) : (
        <CalendarListView
          range={range}
          today={today}
          items={items}
          canWrite={canWrite}
          onOpen={openEvent}
          onCreate={create}
        />
      )}

      <p className="text-xs text-[var(--muted-fg)]">
        Время по поясу проекта: {timezone}. Пунктирная рамка — запись из кастинга или КПП: она
        только для чтения, щелчок открывает источник.
      </p>

      {target ? (
        <EventModal
          // Новый key на каждое открытие: форма начинает с чистого состояния.
          key={"event" in target ? target.event.id : `new-${target.preset.dateKey}`}
          projectId={projectId}
          target={target}
          options={options}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  );
}
