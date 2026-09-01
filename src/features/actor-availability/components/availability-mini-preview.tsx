"use client";

import Link from "next/link";
import {
  addActorToAvailabilityCalendarAction,
  addCastingPersonToAvailabilityCalendarAction,
} from "@/features/actor-availability/actions";
import {
  cellColorClass,
  eachDayInRange,
  startOfWeekMonday,
  toDateKey,
} from "@/features/actor-availability/lib/status";
import { effectiveStatus } from "@/features/actor-availability/lib/planning-hint";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";

type ManualDays = Record<
  string,
  Record<string, { status: string; comment: string | null }>
>;

export function AvailabilityMiniPreview({
  projectId,
  locale,
  rowId,
  actorId,
  castingPersonId,
  manualDays,
  kppBusySerialized,
  canWrite,
}: {
  projectId: string;
  locale: string;
  rowId?: string;
  actorId?: string;
  castingPersonId?: string;
  manualDays: ManualDays;
  kppBusySerialized: Record<string, string[]>;
  canWrite: boolean;
}) {
  const days = eachDayInRange(startOfWeekMonday(new Date()), 14);
  const kppBusy = new Map(
    Object.entries(kppBusySerialized).map(([k, v]) => [k, new Set(v)]),
  );

  const calendarHref = (() => {
    const base = `/${locale}/projects/${projectId}/schedule/availability`;
    if (actorId) return `${base}?actorId=${actorId}`;
    if (castingPersonId) return `${base}?personId=${castingPersonId}`;
    return base;
  })();

  async function ensureAndOpen() {
    if (!rowId) {
      if (actorId) await addActorToAvailabilityCalendarAction(projectId, actorId);
      else if (castingPersonId)
        await addCastingPersonToAvailabilityCalendarAction(projectId, castingPersonId);
    }
    window.location.href = calendarHref;
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted-fg)]">Занятость (2 нед.)</span>
        <Link href={calendarHref} className="text-xs text-[var(--accent)] hover:underline">
          Календарь →
        </Link>
      </div>
      {rowId ? (
        <div className="flex flex-wrap gap-1">
          {days.map((d) => {
            const dateKey = toDateKey(d);
            const kppAuto = actorId ? (kppBusy.get(dateKey)?.has(actorId) ?? false) : false;
            const status = effectiveStatus(rowId, actorId ?? null, dateKey, manualDays, kppBusy);
            return (
              <div
                key={dateKey}
                title={formatDateShort(d, { utc: true })}
                className={`h-5 w-5 rounded-sm border ${cellColorClass(status, { kppAuto })}`}
              />
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted-fg)]">
          Актёр ещё не в общем календаре.
        </p>
      )}
      {canWrite ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-2 w-full text-xs"
          onClick={() => void ensureAndOpen()}
        >
          {rowId ? "Открыть календарь" : "Добавить в календарь"}
        </Button>
      ) : null}
    </div>
  );
}
