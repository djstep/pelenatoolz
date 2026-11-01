import { notFound } from "next/navigation";
import { isWorkingShootDay } from "@/features/schedule/lib/shoot-day-type";
import { CallSheetElementsEditor } from "@/features/call-sheets/components/call-sheet-elements-editor";
import { CallSheetTemplateBlocks } from "@/features/call-sheets/components/call-sheet-template-blocks";
import { SheetBlock } from "@/features/call-sheets/components/sheet-block";
import { getCallSheetElementsEditor } from "@/features/call-sheets/elements-queries";
import { pickAstroPoint } from "@/features/call-sheets/lib/astro-point";
import {
  canReadCallSheet,
  getWorkingDayPosition,
} from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetPrintModel } from "@/features/call-sheets/print/print-model";
import {
  callSheetDataHash,
  callSheetPreviewSrc,
  dayLocationsOf,
  printSourceFromPageData,
} from "@/features/call-sheets/print/print-source";
import {
  getCallSheetForDay,
  getCallSheetStatus,
  listTemplateMemberOptions,
} from "@/features/call-sheets/queries";
import { CallSheetRevisionProvider } from "@/features/call-sheets/components/revision-context";
import {
  CallSheetStatusPanel,
  type CallSheetStatusPanelData,
} from "@/features/call-sheets/components/call-sheet-status-panel";
import { CallSheetView } from "@/features/day-docs/components/call-sheet-view";
import { fetchDayAstro } from "@/features/day-docs/lib/city-astro";
import { ATTENDANCE_SHEET_WRITE_PERMISSION } from "@/features/exports/lib/column-utils";
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

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function CallSheetDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canReadCallSheet(ctx)) {
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

  const canEditCallSheet =
    ctx.can("callsheet:write") || ctx.can("schedule:write");

  const [
    status,
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
    workingDay,
  ] = await Promise.all([
    getCallSheetStatus(projectId, dayId),
    getCallSheetForDay(projectId, dayId),
    getNextShootDayBrief(projectId, bundle.day.dayNumber),
    getActorTimingBaselines(projectId, dayId),
    getResourceTimingBaselines(projectId, dayId),
    listPerShiftCatalogForDay(projectId, dayId),
    listResourceCategories(projectId),
    canEditCallSheet ? listTemplateMemberOptions(projectId) : Promise.resolve([]),
    canEditCallSheet ? listDepartmentsForSmeta(projectId, null) : Promise.resolve([]),
    getCallSheetTransportEditor(ctx, projectId, dayId),
    getCallSheetElementsEditor(projectId, dayId),
    getWorkingDayPosition(projectId, bundle.day),
  ]);

  const dayLocations = dayLocationsOf(bundle);

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

  // Просмотр — тот же лист, что уходит в печать: iframe берёт его маршрутом (HTML в данные
  // страницы не попадает; утверждённый — из снимка). Модель здесь — только для отпечатка.
  const printSource = printSourceFromPageData(bundle, callSheet, elements, astro, workingDay);
  const sheetSrc = callSheetPreviewSrc(
    projectId,
    dayId,
    buildCallSheetPrintModel(printSource),
    status,
  );

  const timeZone = bundle.project.timezone;
  const dateTime = (date: Date) =>
    date.toLocaleString("ru-RU", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  const appliedAtLabel = callSheet ? dateTime(callSheet.templateAppliedAt) : null;

  // Утверждённый — только просмотр (сервер тоже отклоняет правки до «Внести изменения»).
  const approved = status?.status === "APPROVED";
  const canEdit = canEditCallSheet && !approved;
  const approvedSnapshot = approved
    ? status.versions.find((v) => v.version === status.version)
    : undefined;
  const statusPanel: CallSheetStatusPanelData | null = status
    ? {
        status: status.status,
        version: status.version,
        // КПП, либретто и актёры правятся и после утверждения — тогда плашка.
        dataChanged: approvedSnapshot
          ? approvedSnapshot.modelHash !== callSheetDataHash(printSource)
          : false,
        versions: status.versions.map((v) => ({
          version: v.version,
          label: [`Версия ${v.version}`, dateTime(v.approvedAt), v.approvedByName]
            .filter(Boolean)
            .join(" · "),
        })),
      }
    : null;

  return (
    <CallSheetRevisionProvider revision={status?.revision ?? null}>
      <CallSheetView
        locale={locale}
        projectId={projectId}
        bundle={bundle}
        astro={astro}
        nextDay={nextDay}
        nextDayAstro={nextDayAstro}
        canEdit={canEdit}
        canSaveAttendanceSettings={ctx.can(ATTENDANCE_SHEET_WRITE_PERMISSION)}
        sheetSrc={sheetSrc}
        statusPanel={
          statusPanel ? (
            <CallSheetStatusPanel
              projectId={projectId}
              dayId={dayId}
              data={statusPanel}
              canEdit={canEditCallSheet}
              canApprove={ctx.can("callsheet:approve")}
            />
          ) : null
        }
        editBlocks={
          <>
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
              <SheetBlock title="Элементы площадки">
                <CallSheetElementsEditor
                  projectId={projectId}
                  dayId={dayId}
                  data={elements}
                  canEdit={canEdit}
                />
              </SheetBlock>
            ) : null}
          </>
        }
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
    </CallSheetRevisionProvider>
  );
}
