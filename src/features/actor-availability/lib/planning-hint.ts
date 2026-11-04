import type { ActorAvailabilityStatus } from "@prisma/client";
import type { PlanningHint } from "@/features/actor-availability/lib/status";
import { toDateKey } from "@/features/actor-availability/lib/status";
import type { KppBusyMap } from "@/features/actor-availability/queries";

type ManualDaysSerialized = Record<
  string,
  Record<string, { status: string; comment: string | null }>
>;

function isActorBlockedOnDate(
  actorId: string,
  dateKey: string,
  manualDays: ManualDaysSerialized,
  rowIdByActor: Map<string, string>,
  kppBusy: KppBusyMap,
): boolean | null {
  const rowId = rowIdByActor.get(actorId);
  const kppSet = kppBusy.get(dateKey);
  if (kppSet?.has(actorId)) return true;

  if (!rowId) return null;

  const manual = manualDays[rowId]?.[dateKey];
  if (!manual || manual.status === "UNSET" || manual.status === "FREE") return false;
  if (
    manual.status === "BUSY_OTHER" ||
    manual.status === "UNAVAILABLE" ||
    manual.status === "BUSY_OUR_PROJECT"
  ) {
    return true;
  }

  return false;
}

export function computePlanningHint(
  characterIds: string[],
  date: Date,
  characterToActor: Record<string, string>,
  manualDays: ManualDaysSerialized,
  rowIdByActor: Map<string, string>,
  kppBusy: KppBusyMap,
): PlanningHint {
  const actorIds = characterIds
    .map((id) => characterToActor[id])
    .filter((id): id is string => Boolean(id));

  if (actorIds.length === 0) return "neutral";

  const dateKey = toDateKey(date);
  let free = 0;
  let blocked = 0;
  let unknown = 0;

  for (const actorId of actorIds) {
    const blockedState = isActorBlockedOnDate(
      actorId,
      dateKey,
      manualDays,
      rowIdByActor,
      kppBusy,
    );
    if (blockedState === null) unknown++;
    else if (blockedState) blocked++;
    else free++;
  }

  if (blocked === 0 && free > 0) return "all_free";
  if (free === 0 && blocked > 0) return "none_free";
  if (free > 0 && blocked > 0) return "partial";
  if (unknown > 0 && blocked === 0) return "all_free";
  return "partial";
}

/** Слово занятости на карточке сцены в дне КПП («Без дня» — без слова). */
export const planningHintWords: Partial<Record<PlanningHint, string>> = {
  all_free: "свободны",
  partial: "частично",
  none_free: "заняты",
};

type BoardDay = {
  id: string;
  date: Date;
  scenes: { id: string; scene: { characters: { character: { id: string } }[] } }[];
};

/**
 * Занятость актёров сцен, уже стоящих в днях КПП, — одним расчётом на всю доску.
 * Та же `computePlanningHint`, что и кольцо при перетаскивании, но своя запись сцены — не занятость:
 * актёр и так стоит в КПП на этот день. Поэтому из КПП считаются только другие съёмочные дни на ту
 * же дату (второй юнит), а из календаря убран «занят (наш проект)» — его пишет комментарий к дате КПП.
 * Результат: id записи сцены в дне → подсказка.
 */
export function computeDaySceneHints(
  days: BoardDay[],
  characterToActor: Record<string, string>,
  manualDays: ManualDaysSerialized,
  rowIdByActor: Map<string, string>,
): Map<string, PlanningHint> {
  const outsideProject: ManualDaysSerialized = {};
  for (const [rowId, rowDays] of Object.entries(manualDays)) {
    outsideProject[rowId] = Object.fromEntries(
      Object.entries(rowDays).filter(([, day]) => day.status !== "BUSY_OUR_PROJECT"),
    );
  }

  const hints = new Map<string, PlanningHint>();
  for (const day of days) {
    const dateKey = toDateKey(new Date(day.date));
    const otherDays = new Set<string>();
    for (const other of days) {
      if (other.id === day.id || toDateKey(new Date(other.date)) !== dateKey) continue;
      for (const row of other.scenes) {
        for (const { character } of row.scene.characters) {
          const actorId = characterToActor[character.id];
          if (actorId) otherDays.add(actorId);
        }
      }
    }
    const kppBusy: KppBusyMap = new Map([[dateKey, otherDays]]);
    for (const row of day.scenes) {
      hints.set(
        row.id,
        computePlanningHint(
          row.scene.characters.map((c) => c.character.id),
          new Date(day.date),
          characterToActor,
          outsideProject,
          rowIdByActor,
          kppBusy,
        ),
      );
    }
  }
  return hints;
}

export function resolveRowIdByActor(
  rows: { id: string; actorId: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.actorId) map.set(row.actorId, row.id);
  }
  return map;
}

export function effectiveStatus(
  rowId: string,
  actorId: string | null,
  dateKey: string,
  manualDays: ManualDaysSerialized,
  kppBusy: KppBusyMap,
): ActorAvailabilityStatus {
  if (actorId) {
    const kpp = kppBusy.get(dateKey);
    if (kpp?.has(actorId)) return "BUSY_OUR_PROJECT";
  }
  const manual = manualDays[rowId]?.[dateKey];
  return (manual?.status as ActorAvailabilityStatus) ?? "UNSET";
}
