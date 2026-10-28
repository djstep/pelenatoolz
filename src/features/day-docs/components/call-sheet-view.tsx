import Link from "next/link";
import { CallSheetDocument } from "@/features/day-docs/components/call-sheet-document";
import { CallSheetEditor } from "@/features/day-docs/components/call-sheet-edit";
import { CallSheetExportButtons } from "@/features/day-docs/components/call-sheet-export-buttons";
import { CallSheetCharacterScriptsMenu } from "@/features/day-docs/components/call-sheet-character-scripts";
import { CallSheetMoveDateButton } from "@/features/day-docs/components/call-sheet-move-date-button";
import { CallSheetPlanner } from "@/features/day-docs/components/call-sheet-planner";
import { PrintButton } from "@/features/day-docs/components/print-button";
import {
  buildCastForDay,
  buildPerShiftResources,
  buildResourceTables,
  type DayDocBundle,
} from "@/features/day-docs/lib/build-day-doc";
import type { DayAstro } from "@/features/day-docs/lib/city-astro";
import type {
  ActorTimingBaselines,
  ResourceTimingBaselines,
} from "@/features/day-docs/lib/compute-call-timings";
import {
  shootDayStatusLabels,
  shootDayTypeLabels,
} from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import type { getNextShootDayBrief } from "@/features/day-docs/queries";
import type { DayDocsExportResourceCategory } from "@/features/day-docs/components/day-docs-export-menu";

function DocSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`call-sheet-section rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5 ${className}`}
    >
      <h3 className="mb-3 font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function CallSheetView({
  locale,
  projectId,
  bundle,
  astro,
  nextDay,
  nextDayAstro,
  canEdit,
  timingBaselines = {},
  resourceTimingBaselines = {},
  perShiftCatalog = [],
  resourceCategories = [],
}: {
  locale: string;
  projectId: string;
  bundle: DayDocBundle;
  astro: DayAstro | null;
  nextDay: Awaited<ReturnType<typeof getNextShootDayBrief>>;
  nextDayAstro: DayAstro | null;
  canEdit: boolean;
  timingBaselines?: ActorTimingBaselines;
  resourceTimingBaselines?: ResourceTimingBaselines;
  perShiftCatalog?: import("@/features/day-docs/queries").PerShiftCatalogOption[];
  resourceCategories?: DayDocsExportResourceCategory[];
}) {
  const { day } = bundle;
  const cast = buildCastForDay(bundle);
  const resources = buildResourceTables(bundle);
  const perShiftResources = buildPerShiftResources(bundle);

  return (
    <div className="call-sheet-root space-y-6 print:space-y-0">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/call-sheets`}
              className="hover:text-[rgb(var(--tint-rgb))]"
            >
              ← Все вызывные
            </Link>
            {" · "}
            <Link
              href={`/${locale}/projects/${projectId}/schedule`}
              className="hover:text-[rgb(var(--tint-rgb))]"
            >
              КПП
            </Link>
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Вызывной · День {day.dayNumber}
            {day.shiftNumber ? ` · Смена ${day.shiftNumber}` : ""}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{shootDayTypeLabels[day.dayType]}</Badge>
            <Badge>{shootDayStatusLabels[day.status]}</Badge>
            {day.isNightShift ? <Badge>Ночная смена</Badge> : null}
            {day.isLocked ? <Badge>Зафиксирован</Badge> : null}
            {day.unit && day.unit !== "main" ? (
              <Badge>Группа {day.unit}</Badge>
            ) : null}
          </div>
          {astro ? (
            <p className="mt-2 text-xs text-[var(--muted-fg)]">
              Солнце и прогноз: {astro.label}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <CallSheetEditor
              projectId={projectId}
              dayId={day.id}
              bundle={bundle}
              cast={cast}
              resources={resources}
              perShiftResources={perShiftResources}
              perShiftCatalog={perShiftCatalog}
              timingBaselines={timingBaselines}
              resourceTimingBaselines={resourceTimingBaselines}
            />
          ) : null}
          <CallSheetMoveDateButton
            projectId={projectId}
            dayId={day.id}
            dayNumber={day.dayNumber}
            currentDate={day.date}
            locale={locale}
            canEdit={canEdit}
          />
          <CallSheetCharacterScriptsMenu projectId={projectId} cast={cast} />
          <CallSheetExportButtons
            projectId={projectId}
            dayId={day.id}
            resourceCategories={resourceCategories}
          />
          <PrintButton />
        </div>
      </div>

      {canEdit ? (
        <DocSection title="План дня" className="print:hidden">
          <CallSheetPlanner
            projectId={projectId}
            dayId={day.id}
            bundle={bundle}
            canEdit={canEdit}
          />
        </DocSection>
      ) : null}

      {Object.keys(timingBaselines).length > 0 ? (
        <p className="text-xs text-[var(--muted-fg)] print:hidden">
          Жёлтая ячейка — время изменено вручную (наведите, чтобы увидеть
          расчётное). При печати подсветки нет.
        </p>
      ) : null}

      <CallSheetDocument
        bundle={bundle}
        astro={astro}
        cast={cast}
        resources={resources}
        perShiftResources={perShiftResources}
        timingBaselines={timingBaselines}
        resourceTimingBaselines={resourceTimingBaselines}
      />

      {nextDay ? (
        <DocSection title="Следующий съёмочный день" className="print:hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              День {nextDay.dayNumber} · {formatDateShort(nextDay.date)}
            </p>
            {nextDayAstro ? (
              <p className="text-sm text-[var(--muted-fg)]">
                ↑ {nextDayAstro.sunrise || "—"} · ↓ {nextDayAstro.sunset || "—"}
                {nextDayAstro.weatherSummary
                  ? ` · ${nextDayAstro.weatherSummary}`
                  : ""}
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-sm">
            Сцены:{" "}
            {nextDay.scenes.length > 0
              ? nextDay.scenes
                  .map((s) => {
                    const sc = s.scene;
                    const ep = sc.episodeNumber > 0 ? `${sc.episodeNumber}-` : "";
                    return `${ep}${sc.number}${sc.postfix}`;
                  })
                  .join(", ")
              : "не запланированы"}
          </p>
          {nextDay.scenes.length > 0 ? (
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              Объекты:{" "}
              {[
                ...new Set(
                  nextDay.scenes.flatMap((s) =>
                    s.scene.locations.map((l) => l.location.name),
                  ),
                ),
              ].join(", ")}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/call-sheets/${nextDay.id}`}
              className="hover:text-[rgb(var(--tint-rgb))]"
            >
              Открыть вызывной →
            </Link>
          </p>
        </DocSection>
      ) : null}
    </div>
  );
}
