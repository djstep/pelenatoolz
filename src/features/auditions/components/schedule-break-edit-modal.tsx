"use client";

import type { TimeSlotType } from "@prisma/client";
import { useEffect, useState, useTransition } from "react";
import {
  deleteAuditionScheduleBreakAction,
  updateAuditionScheduleBreakAction,
} from "@/features/auditions/actions-schedule";
import type { AuditionScheduleBreakRow } from "@/features/auditions/lib/schedule-shared";
import { SCHEDULE_TIME_SLOTS } from "@/features/auditions/lib/schedule-shared";
import { timeSlotTypeLabels } from "@/features/day-docs/lib/slot-labels";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

export function ScheduleBreakEditModal({
  projectId,
  breakRow,
  canWrite,
  onClose,
}: {
  projectId: string;
  breakRow: AuditionScheduleBreakRow | null;
  canWrite: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("01:00");
  const [slotType, setSlotType] = useState<TimeSlotType>("LUNCH");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!breakRow) return;
    setTime(breakRow.time);
    setDuration(breakRow.duration);
    setSlotType(breakRow.slotType);
    setLabel(breakRow.label);
    setNotes(breakRow.notes ?? "");
  }, [breakRow]);

  if (!breakRow) return null;

  function save() {
    if (!canWrite) return;
    start(async () => {
      const result = await updateAuditionScheduleBreakAction(
        projectId,
        breakRow!.id,
        {
          date: breakRow!.dateKey,
          time,
          duration,
          slotType,
          label,
          notes,
        },
      );
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.success ?? "Сохранено");
        onClose();
      }
    });
  }

  function remove() {
    if (!canWrite) return;
    start(async () => {
      const result = await deleteAuditionScheduleBreakAction(
        projectId,
        breakRow!.id,
      );
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.success ?? "Удалено");
        onClose();
      }
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Технический перерыв"
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={remove}
              className="text-[var(--danger)]"
            >
              Удалить
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
            {canWrite ? (
              <Button type="button" disabled={pending} onClick={save}>
                {pending ? "…" : "Сохранить"}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Название</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Время начала</Label>
            <Select
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!canWrite}
            >
              {SCHEDULE_TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Длительность</Label>
            <HhMmInput
              mode="duration"
              value={duration}
              onChange={setDuration}
              disabled={!canWrite}
              placeholder="01:00"
            />
          </div>
        </div>
        <div>
          <Label>Тип</Label>
          <Select
            value={slotType}
            onChange={(e) => setSlotType(e.target.value as TimeSlotType)}
            disabled={!canWrite}
          >
            {(Object.keys(timeSlotTypeLabels) as TimeSlotType[]).map((k) => (
              <option key={k} value={k}>
                {timeSlotTypeLabels[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Заметки</Label>
          <textarea
            className="glass-input mt-1 min-h-[4.5rem] w-full rounded-xl px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canWrite}
            rows={3}
          />
        </div>
      </div>
    </Modal>
  );
}
