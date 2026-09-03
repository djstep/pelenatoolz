"use client";

import { useEffect, useState, useTransition } from "react";
import {
  deleteAuditionScheduleAction,
  updateAuditionScheduleAction,
} from "@/features/auditions/actions-schedule";
import type {
  AuditionScheduleRow,
  ScheduleCandidateCard,
} from "@/features/auditions/lib/schedule-shared";
import { SCHEDULE_TIME_SLOTS } from "@/features/auditions/lib/schedule-shared";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

export function ScheduleSlotEditModal({
  projectId,
  schedule,
  allCandidates,
  canWrite,
  onClose,
}: {
  projectId: string;
  schedule: AuditionScheduleRow | null;
  allCandidates: ScheduleCandidateCard[];
  canWrite: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [addId, setAddId] = useState("");

  useEffect(() => {
    if (!schedule) return;
    setDate(schedule.dateKey);
    setTime(schedule.time);
    setComment(schedule.comment ?? "");
    setSelected(schedule.candidates.map((c) => c.castingCandidateId));
    setAddId("");
  }, [schedule]);

  if (!schedule) return null;

  const selectedCards = selected
    .map((id) => allCandidates.find((c) => c.id === id))
    .filter(Boolean) as ScheduleCandidateCard[];

  const availableToAdd = allCandidates.filter((c) => !selected.includes(c.id));

  function save() {
    start(async () => {
      const r = await updateAuditionScheduleAction(projectId, schedule!.id, {
        date,
        time,
        comment,
        castingCandidateIds: selected,
      });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.success ?? "Сохранено");
      onClose();
    });
  }

  function remove() {
    if (!confirm("Удалить этот слот расписания?")) return;
    start(async () => {
      const r = await deleteAuditionScheduleAction(projectId, schedule!.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.success ?? "Удалено");
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Редактирование пробы"
      footer={
        <div className="flex flex-wrap justify-between gap-2">
          {canWrite ? (
            <Button type="button" variant="danger" disabled={pending} onClick={remove}>
              Удалить слот
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            {canWrite ? (
              <Button type="button" disabled={pending || selected.length === 0} onClick={save}>
                {pending ? "…" : "Сохранить"}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Дата</Label>
            <Input
              type="date"
              value={date}
              disabled={!canWrite}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Время</Label>
            <Select
              value={time}
              disabled={!canWrite}
              onChange={(e) => setTime(e.target.value)}
            >
              {!SCHEDULE_TIME_SLOTS.includes(
                time as (typeof SCHEDULE_TIME_SLOTS)[number],
              ) ? (
                <option value={time}>{time}</option>
              ) : null}
              {SCHEDULE_TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label>Комментарий</Label>
          <Input
            value={comment}
            disabled={!canWrite}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Кандидаты</Label>
          <ul className="space-y-1">
            {selectedCards.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span>
                  {c.person.label}
                  <span className="text-[var(--muted-fg)]">
                    {" "}
                    · {c.character.name}
                  </span>
                </span>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() =>
                      setSelected((prev) => prev.filter((id) => id !== c.id))
                    }
                  >
                    Убрать
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {canWrite && availableToAdd.length > 0 ? (
            <div className="flex gap-2">
              <Select
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
              >
                <option value="">Добавить кандидата…</option>
                {availableToAdd.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.person.label} · {c.character.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="secondary"
                disabled={!addId}
                onClick={() => {
                  if (!addId) return;
                  setSelected((prev) => [...prev, addId]);
                  setAddId("");
                }}
              >
                +
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
