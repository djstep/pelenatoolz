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
