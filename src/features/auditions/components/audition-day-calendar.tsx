"use client";

import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import {
  SCHEDULE_TIME_SLOTS,
  type AuditionScheduleBreakRow,
  type AuditionScheduleRow,
} from "@/features/auditions/lib/schedule-shared";
import { auditionKindLabels } from "@/features/auditions/lib/types";
import { addMinutesToTime } from "@/features/day-docs/lib/time-utils";
import { parseHhMmToMinutes } from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const WEEKDAY_LONG = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

function endTimeLabel(start: string, duration: string) {
  const mins = parseHhMmToMinutes(duration);
  if (mins == null) return duration;
  return addMinutesToTime(start, mins);
}

function DaySlotCell({
  dateKey,
  time,
  schedules,
  breaks,
  canWrite,
  onOpenSchedule,
  onOpenBreak,
}: {
  dateKey: string;
  time: string;
  schedules: AuditionScheduleRow[];
  breaks: AuditionScheduleBreakRow[];
  canWrite: boolean;
  onOpenSchedule: (s: AuditionScheduleRow) => void;
  onOpenBreak: (b: AuditionScheduleBreakRow) => void;
}) {
  const id = `slot-${dateKey}-${time}`;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { dateKey, time },
    disabled: !canWrite,
  });

  const hereSchedules = schedules.filter(
    (s) => s.dateKey === dateKey && s.time === time,
  );
  const hereBreaks = breaks.filter(
    (b) => b.dateKey === dateKey && b.time === time,
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[7.5rem] border-b border-[var(--border)]/60 p-2",
        isOver && "bg-[var(--accent)]/15",
      )}
    >
      <div className="flex flex-wrap gap-2">
        {hereBreaks.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onOpenBreak(b)}
            className="min-w-[10rem] flex-1 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-left hover:border-[var(--accent)]"
          >
            <div className="text-sm font-medium text-[var(--foreground)]">
              {b.label}
            </div>
            <div className="text-xs text-[var(--muted-fg)]">
              {b.time}–{endTimeLabel(b.time, b.duration)} · {b.duration}
            </div>
          </button>
        ))}
        {hereSchedules.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpenSchedule(s)}
            className="min-w-[12rem] flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2.5 text-left hover:border-[var(--accent)]"
          >
            <div className="text-sm font-medium text-[var(--foreground)]">
              {auditionKindLabels[s.kind]} · {s.candidates.length}
            </div>
            <div className="mt-2 space-y-2">
              {s.candidates.map((c) => (
                <div key={c.castingCandidateId} className="flex gap-2">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    {c.person.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.person.photoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-[var(--muted-fg)]">
                        ?
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {c.person.label}
                    </div>
                    <div className="truncate text-xs text-[var(--muted-fg)]">
                      {c.character.name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {s.comment ? (
              <p className="mt-2 text-xs text-[var(--muted-fg)]">{s.comment}</p>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AuditionDayCalendar({
  dateKey,
  weekdayIndex,
  schedules,
  breaks,
  canWrite,
  onBack,
  onOpenSchedule,
  onOpenBreak,
  onShiftDay,
}: {
  dateKey: string;
  weekdayIndex: number;
  schedules: AuditionScheduleRow[];
  breaks: AuditionScheduleBreakRow[];
  canWrite: boolean;
  onBack: () => void;
  onOpenSchedule: (s: AuditionScheduleRow) => void;
  onOpenBreak: (b: AuditionScheduleBreakRow) => void;
  onShiftDay: (delta: number) => void;
}) {
  const daySchedules = useMemo(
    () => schedules.filter((s) => s.dateKey === dateKey),
    [schedules, dateKey],
  );
  const dayBreaks = useMemo(
    () => breaks.filter((b) => b.dateKey === dateKey),
    [breaks, dateKey],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onBack}>
            ← Неделя
          </Button>
          <Button type="button" variant="secondary" onClick={() => onShiftDay(-1)}>
            ←
          </Button>
          <Button type="button" variant="secondary" onClick={() => onShiftDay(1)}>
            →
          </Button>
        </div>
        <div className="text-right">
          <p className="text-sm text-[var(--muted-fg)]">
            {WEEKDAY_LONG[weekdayIndex] ?? ""}
          </p>
          <p className="text-base font-semibold">{formatDateShort(dateKey)}</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)]">
        <div
          className="grid"
          style={{ gridTemplateColumns: "5.5rem minmax(0, 1fr)" }}
        >
          {SCHEDULE_TIME_SLOTS.map((time) => (
            <div key={time} className="contents">
              <div className="border-b border-r border-[var(--border)]/60 p-3 text-sm font-medium text-[var(--muted-fg)]">
                {time}
              </div>
              <DaySlotCell
                dateKey={dateKey}
                time={time}
                schedules={daySchedules}
                breaks={dayBreaks}
                canWrite={canWrite}
                onOpenSchedule={onOpenSchedule}
                onOpenBreak={onOpenBreak}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
