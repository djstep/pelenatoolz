import {
  buildKppActorBusyMap,
  buildManualDayMap,
  listAvailabilityRows,
} from "@/features/actor-availability/queries";
import { prisma } from "@/shared/db/prisma";

function serializeManualDays(
  map: ReturnType<typeof buildManualDayMap>,
): Record<string, Record<string, { status: string; comment: string | null }>> {
  const out: Record<string, Record<string, { status: string; comment: string | null }>> = {};
  for (const [rowId, days] of map.entries()) {
    out[rowId] = {};
    for (const [dateKey, val] of days.entries()) {
      out[rowId][dateKey] = val;
    }
  }
  return out;
}

function serializeKppBusy(map: Awaited<ReturnType<typeof buildKppActorBusyMap>>) {
  const out: Record<string, string[]> = {};
  for (const [key, set] of map.entries()) {
    out[key] = Array.from(set);
  }
  return out;
}

export async function getAvailabilityMiniBundle(projectId: string) {
  const [rows, kppBusy] = await Promise.all([
    listAvailabilityRows(projectId),
    buildKppActorBusyMap(projectId),
  ]);
  return {
    manualDays: serializeManualDays(buildManualDayMap(rows)),
    kppBusySerialized: serializeKppBusy(kppBusy),
    rowByActorId: Object.fromEntries(
      rows
        .filter((r: { actorId: string | null }) => r.actorId)
        .map((r: { actorId: string | null; id: string }) => [r.actorId!, r.id]),
    ),
    rowByPersonId: Object.fromEntries(
      rows
        .filter((r: { castingPersonId: string | null }) => r.castingPersonId)
        .map((r: { castingPersonId: string | null; id: string }) => [
          r.castingPersonId!,
          r.id,
        ]),
    ),
  };
}

export async function getScheduleAvailabilityClientBundle(projectId: string) {
  const bundle = await getAvailabilityMiniBundle(projectId);
  const actors = await prisma.actor.findMany({
    where: { projectId, characterId: { not: null } },
    select: {
      id: true,
      characterId: true,
      lastName: true,
      firstName: true,
      middleName: true,
    },
  });
  const actorNames = Object.fromEntries(
    actors.map((a) => [
      a.id,
      [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" "),
    ]),
  );
  return {
    ...bundle,
    characterToActor: Object.fromEntries(
      actors.filter((a) => a.characterId).map((a) => [a.characterId!, a.id]),
    ),
    actorNames,
    rows: (
      await listAvailabilityRows(projectId)
    ).map((r: { id: string; actorId: string | null }) => ({
      id: r.id,
      actorId: r.actorId,
    })),
  };
}

export type ScheduleAvailabilityBundle = Awaited<
  ReturnType<typeof getScheduleAvailabilityClientBundle>
>;
