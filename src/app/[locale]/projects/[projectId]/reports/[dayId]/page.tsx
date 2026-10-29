import Link from "next/link";
import { notFound } from "next/navigation";
import { DayDocsExportMenu } from "@/features/day-docs/components/day-docs-export-menu";
import { ProductionReportWorkspace } from "@/features/reports/components/production-report-workspace";
import {
  ReportCreatePanel,
  ReportStalePanel,
} from "@/features/reports/components/report-refresh-panel";
import {
  getProductionReport,
  getReportStaleness,
  getShootDayBrief,
} from "@/features/reports/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listResourceCategories } from "@/features/resources/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

/** Открытие отчёта ничего не пишет в базу: пересборка — только «Создать / Обновить из КПП». */
export default async function ProductionReportDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("report:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к отчётам</p>;
  }

  const canEdit = ctx.can("report:write") || ctx.can("schedule:write");

  const [day, bundle, staleness, resourceCategories] = await Promise.all([
    getShootDayBrief(projectId, dayId),
    getProductionReport(projectId, dayId),
    getReportStaleness(projectId, dayId),
    listResourceCategories(projectId),
  ]);
  if (!day) notFound();

  if (!bundle) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm text-[var(--muted-fg)]">
            <Link
              href={`/${locale}/projects/${projectId}/reports`}
              className="hover:text-[rgb(var(--tint-rgb))]"
            >
              ← Все отчёты
            </Link>
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Производственный отчёт · День {day.dayNumber}
          </h2>
        </div>
        <ReportCreatePanel projectId={projectId} shootDayId={dayId} canEdit={canEdit} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {staleness?.stale ? (
        <ReportStalePanel
          projectId={projectId}
          shootDayId={dayId}
          staleness={staleness}
          canEdit={canEdit}
        />
      ) : null}
      <ProductionReportWorkspace
        locale={locale}
        projectId={projectId}
        bundle={bundle}
        canEdit={canEdit}
        exportMenu={
          <DayDocsExportMenu
            projectId={projectId}
            dayId={dayId}
            resourceCategories={resourceCategories.map((c) => ({
              id: c.id,
              name: c.name,
              perShift: c.perShift,
            }))}
            showCallSheetExports={false}
          />
        }
      />
    </div>
  );
}
