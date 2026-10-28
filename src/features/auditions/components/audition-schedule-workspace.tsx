"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState, useTransition } from "react";
import { assignCandidateToScheduleSlotAction } from "@/features/auditions/actions-schedule";
import { AuditionDayCalendar } from "@/features/auditions/components/audition-day-calendar";
import { AuditionWeekCalendar } from "@/features/auditions/components/audition-week-calendar";
import { ScheduleCandidatePanel } from "@/features/auditions/components/schedule-candidate-panel";
import { ScheduleExportModal } from "@/features/auditions/components/schedule-export-modal";
import { ScheduleSlotEditModal } from "@/features/auditions/components/schedule-slot-edit-modal";
import type {
  AuditionScheduleRow,
  ScheduleCandidateCard,
} from "@/features/auditions/lib/schedule-shared";
import {
  addDays,
  parseDateKey,
  toDateKey,
} from "@/features/actor-availability/lib/status";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

export function AuditionScheduleWorkspace({
  projectId,
  candidates,
  schedules,
  characters,
  canWrite,
}: {
  projectId: string;
  candidates: ScheduleCandidateCard[];
  schedules: AuditionScheduleRow[];
  characters: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [weekAnchorIso, setWeekAnchorIso] = useState(() =>
    new Date().toISOString(),
  );
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<AuditionScheduleRow | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [activeCandId, setActiveCandId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeCard = activeCandId
    ? candidates.find((c) => c.id === activeCandId)
    : null;

  const dayWeekdayIndex = useMemo(() => {
    if (!dayKey) return 0;
    const d = parseDateKey(dayKey);
    // Mon=0 … Sun=6
    return (d.getDay() + 6) % 7;
  }, [dayKey]);

  function onDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith("cand-")) {
      setActiveCandId(id.slice(5));
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const candId = activeCandId;
    setActiveCandId(null);
    if (!canWrite || pending) return;

    const overId = event.over ? String(event.over.id) : null;
    if (!overId?.startsWith("slot-")) return;

    const dateKey = event.over?.data.current?.dateKey as string | undefined;
    const time = event.over?.data.current?.time as string | undefined;
    if (!dateKey || !time) return;

    const castingCandidateId =
      candId ??
      (event.active.data.current?.castingCandidateId as string | undefined);
    if (!castingCandidateId) return;

    const existing = schedules.find(
      (s) => s.dateKey === dateKey && s.time === time,
    );

    start(async () => {
      const result = await assignCandidateToScheduleSlotAction(projectId, {
        castingCandidateId,
        date: dateKey,
        time,
        scheduleId: existing?.id ?? null,
      });
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Запланировано");
    });
  }

  function shiftDay(delta: number) {
    if (!dayKey) return;
    const next = addDays(parseDateKey(dayKey), delta);
    const nextKey = toDateKey(next);
    setDayKey(nextKey);
    setWeekAnchorIso(next.toISOString());
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted-fg)]">
          {dayKey
            ? "Детальный план дня: перетащите кандидатов на шкалу времени."
            : "Перетащите кандидата на ячейку. Клик по дате — план на день."}
        </p>
        <Button type="button" variant="secondary" onClick={() => setExportOpen(true)}>
          Экспорт
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-h-[36rem] flex-col gap-4 lg:flex-row">
          <div className="flex w-full flex-col gap-4 lg:w-80 lg:shrink-0">
            <ScheduleCandidatePanel
              projectId={projectId}
              candidates={candidates}
              characters={characters}
              canWrite={canWrite}
              size={dayKey ? "lg" : "sm"}
            />
          </div>
          {dayKey ? (
            <AuditionDayCalendar
              dateKey={dayKey}
              weekdayIndex={dayWeekdayIndex}
              schedules={schedules}
              canWrite={canWrite}
              onBack={() => setDayKey(null)}
              onOpenSchedule={setEditing}
              onShiftDay={shiftDay}
            />
          ) : (
            <AuditionWeekCalendar
              weekAnchorIso={weekAnchorIso}
              onWeekChange={setWeekAnchorIso}
              schedules={schedules}
              canWrite={canWrite}
              onOpenSchedule={setEditing}
              onOpenDay={setDayKey}
            />
          )}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className="rounded-xl border border-[var(--accent)] bg-[var(--panel-solid)] px-3 py-2 text-sm shadow-xl">
              {activeCard.person.label}
              <div className="text-xs text-[var(--muted-fg)]">
                {activeCard.character.name}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ScheduleSlotEditModal
        projectId={projectId}
        schedule={editing}
        allCandidates={candidates}
        canWrite={canWrite}
        onClose={() => setEditing(null)}
      />
      <ScheduleExportModal
        projectId={projectId}
        weekAnchorIso={weekAnchorIso}
        dayKey={dayKey}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
