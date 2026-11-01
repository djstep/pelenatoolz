import type { CallSheetUnit, TimeSlotType } from "@prisma/client";
import { breakCustomLabel } from "@/features/day-docs/lib/plan-rules";
import { addMinutesToTime, normalizeHhMm } from "@/features/day-docs/lib/time-utils";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { hhMmToMinutes } from "@/shared/ui/hh-mm-input";

export type DayPlanSceneItem = {
  kind: "scene";
  id: string;
  assignmentId: string;
  sceneId: string;
  label: string;
  duration: string;
  /** «Продолжение сцены N» — та же сцена ещё раз (например после обеда). */
  isContinuation?: boolean;
};

export type DayPlanBreakItem = {
  kind: "break";
  id: string;
  slotType: TimeSlotType;
  /** Подпись строки; совпадает с названием типа — свой текст не хранится. */
  label: string;
  duration: string;
  notes: string;
};

export type DayPlanItem = DayPlanSceneItem | DayPlanBreakItem;

export type ComputedPlanSlot = {
  startTime: string;
  endTime: string | null;
  slotType: TimeSlotType;
  sceneId: string | null;
  notes: string | null;
  unit: CallSheetUnit;
  isContinuation: boolean;
  customLabel: string | null;
};

/** Строка дорожки «2-й юнит»: добавляется и правится руками, каскад её не трогает. */
export type SecondUnitRow = {
  id: string;
  startTime: string;
  endTime: string;
  slotType: TimeSlotType;
  sceneId: string | null;
  isContinuation: boolean;
  customLabel: string;
  notes: string;
};

/**
 * Каскад основного юнита: строки идут подряд от начала смены, конец = начало + длительность.
 * Вырезанные сцены (`cutSceneIds`) пропускаются и время не занимают.
 */
export function cascadeDayPlan(
  shiftStart: string,
  items: DayPlanItem[],
  cutSceneIds: ReadonlySet<string> = new Set(),
): ComputedPlanSlot[] {
  let cursor = shiftStart;
  const result: ComputedPlanSlot[] = [];

  for (const item of items) {
    if (item.kind === "scene" && cutSceneIds.has(item.sceneId)) continue;
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
        unit: "MAIN",
        isContinuation: Boolean(item.isContinuation),
        customLabel: null,
      });
    } else {
      result.push({
        startTime,
        endTime,
        slotType: item.slotType,
        sceneId: null,
        notes: item.notes.trim() || null,
        unit: "MAIN",
        isContinuation: false,
        customLabel: breakCustomLabel(item.slotType, item.label),
      });
    }
  }

  return result;
}

/** Строки 2-го юнита для сохранения — как ввели, без пересчёта. */
export function secondUnitSlots(rows: SecondUnitRow[]): ComputedPlanSlot[] {
  return rows.map((row) => ({
    startTime: normalizeHhMm(row.startTime),
    endTime: row.endTime.trim() ? normalizeHhMm(row.endTime) : null,
    slotType: row.slotType,
    sceneId: row.sceneId || null,
    notes: row.notes.trim() || null,
    unit: "SECOND",
    isContinuation: Boolean(row.sceneId) && row.isContinuation,
    customLabel: row.customLabel.trim() || null,
  }));
}

/**
 * Все строки плана для сохранения: основной юнит каскадом, затем 2-й юнит без изменений.
 * Сохранение планера пересчитывает только основной юнит и не теряет строки 2-го.
 */
export function buildPlanSlots(
  shiftStart: string,
  mainItems: DayPlanItem[],
  secondRows: SecondUnitRow[],
  cutSceneIds: ReadonlySet<string> = new Set(),
): ComputedPlanSlot[] {
  return [...cascadeDayPlan(shiftStart, mainItems, cutSceneIds), ...secondUnitSlots(secondRows)];
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
