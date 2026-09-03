import type { TimeSlotType } from "@prisma/client";
import { addMinutesToTime } from "@/features/day-docs/lib/time-utils";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { hhMmToMinutes } from "@/shared/ui/hh-mm-input";

export type DayPlanSceneItem = {
  kind: "scene";
  id: string;
  assignmentId: string;
  sceneId: string;
  label: string;
  duration: string;
};

export type DayPlanBreakItem = {
  kind: "break";
  id: string;
  slotType: TimeSlotType;
  label: string;
  duration: string;
  notes: string;
};

export type DayPlanItem = DayPlanSceneItem | DayPlanBreakItem;

export type ComputedPlanSlot = {
  startTime: string;
  endTime: string;
  slotType: TimeSlotType;
  sceneId: string | null;
  notes: string | null;
};

export function cascadeDayPlan(
  shiftStart: string,
  items: DayPlanItem[],
): ComputedPlanSlot[] {
  let cursor = shiftStart;
  const result: ComputedPlanSlot[] = [];

  for (const item of items) {
    const durationMin = hhMmToMinutes(item.duration, "duration");
    if (durationMin <= 0) continue;
    const startTime = cursor;
    const endTime = addMinutesToTime(cursor, durationMin);
    cursor = endTime;

    if (item.kind === "scene") {
      result.push({
        startTime,
        endTime,
        slotType: "SHOOTING",
        sceneId: item.sceneId,
        notes: null,
      });
    } else {
      const noteParts = [item.label.trim(), item.notes.trim()].filter(Boolean);
      result.push({
        startTime,
        endTime,
        slotType: item.slotType,
        sceneId: null,
        notes: noteParts.length > 0 ? noteParts.join(" — ") : null,
      });
    }
  }

  return result;
}

export function sceneDurationFromPlanSeconds(planSeconds: number | null): string {
  if (!planSeconds || planSeconds <= 0) return "00:30";
  return formatMinutesHhMm(Math.max(5, Math.round(planSeconds / 60)));
}

export function durationFromSlotTimes(startTime: string, endTime: string | null): string {
  if (!endTime) return "00:30";
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const mins = Math.max(5, (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0)));
  return formatMinutesHhMm(mins);
}
