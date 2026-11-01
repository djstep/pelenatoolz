import { notFound } from "next/navigation";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { CallSheetElementsEditor } from "@/features/call-sheets/components/call-sheet-elements-editor";
import { CallSheetTemplateBlocks } from "@/features/call-sheets/components/call-sheet-template-blocks";
import { getCallSheetElementsEditor } from "@/features/call-sheets/elements-queries";
import { pickAstroPoint } from "@/features/call-sheets/lib/astro-point";
import { getCallSheetForDay, listTemplateMemberOptions } from "@/features/call-sheets/queries";
import { CallSheetView } from "@/features/day-docs/components/call-sheet-view";
import { fetchDayAstro } from "@/features/day-docs/lib/city-astro";
import {
  getNextShootDayBrief,
  getShootDayDocument,
  getActorTimingBaselines,
  getResourceTimingBaselines,
  listPerShiftCatalogForDay,
} from "@/features/day-docs/queries";
import { getCallSheetTransportEditor } from "@/features/day-docs/transport-queries";
import { listDepartmentsForSmeta } from "@/features/departments/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listResourceCategories } from "@/features/resources/queries";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function CallSheetDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("callsheet:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к вызывным</p>;
  }

  // Открытие страницы ничего не пишет: ресурсы смены из сцен дня — кнопкой «Обновить из КПП».
  const bundle = await getShootDayDocument(projectId, dayId);
  if (!bundle) notFound();

  if (!isWorkingShootDay(bundle.day.dayType)) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-[var(--muted-fg)]">
          Вызывной лист формируется только для{" "}
          <strong>рабочих</strong> съёмочных дней. День {bundle.day.dayNumber} —{" "}
          {bundle.day.dayType === "OFF"
            ? "выходной"
            : bundle.day.dayType === "REST"
              ? "отсыпной"
              : bundle.day.dayType === "PREP"
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

  const canEdit =
    ctx.can("callsheet:write") || ctx.can("schedule:write");

  const [
    callSheet,
    nextDay,
    timingBaselines,
    resourceTimingBaselines,
    perShiftCatalog,
    resourceCategories,
    members,
    departments,
    transportEditor,
    elements,
  ] = await Promise.all([
    getCallSheetForDay(projectId, dayId),
    getNextShootDayBrief(projectId, bundle.day.dayNumber),
    getActorTimingBaselines(projectId, dayId),
    getResourceTimingBaselines(projectId, dayId),
    listPerShiftCatalogForDay(projectId, dayId),
    listResourceCategories(projectId),
    canEdit ? listTemplateMemberOptions(projectId) : Promise.resolve([]),
    canEdit ? listDepartmentsForSmeta(projectId, null) : Promise.resolve([]),
    getCallSheetTransportEditor(ctx, projectId, dayId),
    getCallSheetElementsEditor(projectId, dayId),
  ]);

  // Объекты сцен дня — без повторов, по порядку сцен.
  const dayLocations = [
    ...new Map(
      bundle.day.scenes
        .flatMap((s) => s.scene.locations.map((l) => l.location))
        .map((location) => [location.id, location]),
    ).values(),
  ];

  // Солнце и погода: по координатам объекта, координат нет — по городу проекта.
  const [astro, nextDayAstro] = await Promise.all([
    fetchDayAstro(
      {
        city: bundle.project.city,
        point: pickAstroPoint(callSheet?.schemeLocation, dayLocations),
      },
      bundle.day.date,
      bundle.project.timezone,
    ),
    nextDay
      ? fetchDayAstro(
          {
            city: bundle.project.city,
            point: pickAstroPoint(
              null,
              nextDay.scenes.flatMap((s) => s.scene.locations.map((l) => l.location)),
            ),
          },
          nextDay.date,
          bundle.project.timezone,
        )
      : Promise.resolve(null),
  ]);

  const appliedAtLabel = callSheet
    ? callSheet.templateAppliedAt.toLocaleString("ru-RU", {
        timeZone: bundle.project.timezone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-4">
      <CallSheetTemplateBlocks
        locale={locale}
        projectId={projectId}
        dayId={dayId}
        callSheet={callSheet}
        appliedAtLabel={appliedAtLabel}
        canEdit={canEdit}
        members={members}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        locations={dayLocations.map((l) => ({
          id: l.id,
          label: [l.name, l.sublocation].filter(Boolean).join(". "),
        }))}
      />
      {elements ? (
        <Card>
          <h3 className="mb-3 font-semibold">Элементы площадки</h3>
          <CallSheetElementsEditor
            projectId={projectId}
            dayId={dayId}
            data={elements}
            canEdit={canEdit}
          />
        </Card>
      ) : null}
      <CallSheetView
        locale={locale}
        projectId={projectId}
        bundle={bundle}
        astro={astro}
        nextDay={nextDay}
        nextDayAstro={nextDayAstro}
        canEdit={canEdit}
        timingBaselines={timingBaselines}
        resourceTimingBaselines={resourceTimingBaselines}
        perShiftCatalog={perShiftCatalog}
        resourceCategories={resourceCategories.map((c) => ({
          id: c.id,
          name: c.name,
          perShift: c.perShift,
        }))}
        transportEditor={transportEditor}
      />
    </div>
  );
}
