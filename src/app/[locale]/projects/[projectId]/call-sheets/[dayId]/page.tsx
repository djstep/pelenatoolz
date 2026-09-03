import { notFound } from "next/navigation";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { syncShootDayResourceUsages } from "@/features/schedule/lib/sync-shoot-day-resources";
import { CallSheetView } from "@/features/day-docs/components/call-sheet-view";
import { fetchCityAstro } from "@/features/day-docs/lib/city-astro";
import {
  getNextShootDayBrief,
  getShootDayDocument,
  getActorTimingBaselines,
  getResourceTimingBaselines,
  listPerShiftCatalogForDay,
} from "@/features/day-docs/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function CallSheetDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("callsheet:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к вызывным</p>;
  }

  const bundle = await getShootDayDocument(projectId, dayId);
  if (!bundle) notFound();

  if (isWorkingShootDay(bundle.day.dayType)) {
    await syncShootDayResourceUsages(dayId);
  }

  const bundleFresh = isWorkingShootDay(bundle.day.dayType)
    ? (await getShootDayDocument(projectId, dayId)) ?? bundle
    : bundle;

  if (!isWorkingShootDay(bundleFresh.day.dayType)) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-fg)]">
          Вызывной лист формируется только для{" "}
          <strong>рабочих</strong> съёмочных дней. День {bundleFresh.day.dayNumber} —{" "}
          {bundleFresh.day.dayType === "OFF"
            ? "выходной"
            : bundleFresh.day.dayType === "REST"
              ? "отсыпной"
              : bundleFresh.day.dayType === "PREP"
                ? "подготовительный"
                : "нерабочий"}
          .
        </p>
        <a
          href={`/${locale}/projects/${projectId}/schedule`}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← КПП
        </a>
      </div>
    );
  }

  const [astro, nextDay, timingBaselines, resourceTimingBaselines, perShiftCatalog] =
    await Promise.all([
    fetchCityAstro(
      bundleFresh.project.city,
      bundleFresh.day.date,
      bundleFresh.project.timezone,
    ),
    getNextShootDayBrief(projectId, bundleFresh.day.dayNumber),
    getActorTimingBaselines(projectId, dayId),
    getResourceTimingBaselines(projectId, dayId),
    listPerShiftCatalogForDay(projectId, dayId),
  ]);

  const nextDayAstro = nextDay
    ? await fetchCityAstro(
        bundleFresh.project.city,
        nextDay.date,
        bundleFresh.project.timezone,
      )
    : null;

  const canEdit =
    ctx.can("callsheet:write") || ctx.can("schedule:write");

  return (
    <CallSheetView
      locale={locale}
      projectId={projectId}
      bundle={bundleFresh}
      astro={astro}
      nextDay={nextDay}
      nextDayAstro={nextDayAstro}
      canEdit={canEdit}
      timingBaselines={timingBaselines}
      resourceTimingBaselines={resourceTimingBaselines}
      perShiftCatalog={perShiftCatalog}
    />
  );
}
