import { AvailabilityCalendar } from "@/features/actor-availability/components/availability-calendar";
import {
  buildKppActorBusyMap,
  buildManualDayMap,
  ensureAvailabilityRowForActor,
  ensureAvailabilityRowForCastingPerson,
  listActorsForAvailabilityPicker,
  listAvailabilityRows,
} from "@/features/actor-availability/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ actorId?: string; personId?: string }>;
};

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

export default async function AvailabilityPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { actorId, personId } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("schedule:read") && !ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const canWrite = ctx.can("schedule:write") || ctx.can("cast:write");

  if (actorId && canWrite) {
    await ensureAvailabilityRowForActor(projectId, actorId);
  }
  if (personId && canWrite) {
    await ensureAvailabilityRowForCastingPerson(projectId, personId);
  }

  const [rows, actors, kppBusy] = await Promise.all([
    listAvailabilityRows(projectId),
    listActorsForAvailabilityPicker(projectId),
    buildKppActorBusyMap(projectId),
  ]);

  const manualDays = serializeManualDays(buildManualDayMap(rows));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Занятость актёров</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Клик по ячейке — смена статуса · ПКМ — комментарий · фиолетовый — съёмка по КПП
        </p>
      </div>
      <Card className="p-4">
        <AvailabilityCalendar
          projectId={projectId}
          locale={locale}
          rows={rows}
          actors={actors}
          kppBusySerialized={serializeKppBusy(kppBusy)}
          manualDays={manualDays}
          canWrite={canWrite}
          initialActorId={actorId}
          initialPersonId={personId}
        />
      </Card>
    </div>
  );
}
