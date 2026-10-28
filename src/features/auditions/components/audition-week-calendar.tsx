"use client";

import { useDroppable } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import {
  SCHEDULE_TIME_SLOTS,
  type AuditionScheduleRow,
} from "@/features/auditions/lib/schedule-shared";
import { auditionKindLabels } from "@/features/auditions/lib/types";
import {
  addDays,
  startOfWeekMonday,
  toDateKey,
} from "@/features/actor-availability/lib/status";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function SlotCell({
  dateKey,
  time,
  schedules,
  canWrite,
  onOpenSchedule,
}: {
  dateKey: string;
  time: string;
  schedules: AuditionScheduleRow[];
  canWrite: boolean;
  onOpenSchedule: (s: AuditionScheduleRow) => void;
}) {
  const id = `slot-${dateKey}-${time}`;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { dateKey, time },
    disabled: !canWrite,
  });

  const here = schedules.filter(
    (s) => s.dateKey === dateKey && s.time === time,
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[4.5rem] border-b border-r border-[var(--border)]/60 p-1 align-top",
        isOver && "bg-[var(--accent)]/15",
      )}
    >
      {here.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onOpenSchedule(s)}
          className="mb-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1 text-left text-[10px] hover:border-[var(--accent)]"
        >
          <div className="font-medium text-[var(--foreground)]">
            {auditionKindLabels[s.kind]} · {s.candidates.length}
          </div>
          {s.candidates.slice(0, 2).map((c) => (
            <div key={c.castingCandidateId} className="truncate text-[var(--muted-fg)]">
              {c.person.label}
            </div>
          ))}
          {s.candidates.length > 2 ? (
            <div className="text-[var(--muted-fg)]">
              +{s.candidates.length - 2}
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function AuditionWeekCalendar({
  weekAnchorIso,
  onWeekChange,
  schedules,
  canWrite,
  onOpenSchedule,
  onOpenDay,
}: {
  weekAnchorIso: string;
  onWeekChange: (iso: string) => void;
  schedules: AuditionScheduleRow[];
  canWrite: boolean;
  onOpenSchedule: (s: AuditionScheduleRow) => void;
  onOpenDay: (dateKey: string) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeekMonday(new Date(weekAnchorIso));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekAnchorIso]);

  const weekSchedules = useMemo(() => {
    const keys = new Set(days.map((d) => toDateKey(d)));
    return schedules.filter((s) => keys.has(s.dateKey));
  }, [schedules, days]);

  function shiftWeek(delta: number) {
    const start = startOfWeekMonday(new Date(weekAnchorIso));
    const next = addDays(start, delta * 7);
    onWeekChange(next.toISOString());
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => shiftWeek(-1)}>
            ←
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onWeekChange(new Date().toISOString())}
          >
            Сегодня
          </Button>
          <Button type="button" variant="secondary" onClick={() => shiftWeek(1)}>
            →
          </Button>
        </div>
        <p className="text-sm text-[var(--muted-fg)]">
          {formatDateShort(days[0]!)} — {formatDateShort(days[6]!)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)]">
        <div
          className="grid min-w-[720px]"
          style={{ gridTemplateColumns: "4.5rem repeat(7, minmax(0, 1fr))" }}
        >
          <div className="sticky top-0 z-10 border-b border-r border-[var(--border)] bg-[var(--panel-solid)] p-2 text-xs text-[var(--muted-fg)]" />
          {days.map((d, i) => {
            const key = toDateKey(d);
            return (
              <button
                key={key}
                type="button"
                onClick={() => onOpenDay(key)}
                className="sticky top-0 z-10 border-b border-r border-[var(--border)] bg-[var(--panel-solid)] p-2 text-center transition hover:bg-[var(--accent)]/10"
                title="Открыть день"
              >
                <div className="text-xs text-[var(--muted-fg)]">
                  {WEEKDAY_SHORT[i]}
                </div>
                <div className="text-sm font-medium">{formatDateShort(d)}</div>
              </button>
            );
          })}

          {SCHEDULE_TIME_SLOTS.map((time) => (
            <div key={time} className="contents">
              <div className="border-b border-r border-[var(--border)]/60 p-2 text-xs text-[var(--muted-fg)]">
                {time}
              </div>
              {days.map((d) => (
                <SlotCell
                  key={`${toDateKey(d)}-${time}`}
                  dateKey={toDateKey(d)}
                  time={time}
                  schedules={weekSchedules}
                  canWrite={canWrite}
                  onOpenSchedule={onOpenSchedule}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useWeekAnchorState() {
  return useState(() => new Date().toISOString());
}
