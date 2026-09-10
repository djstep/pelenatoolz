import { notFound } from "next/navigation";
import { DayDocsExportMenu } from "@/features/day-docs/components/day-docs-export-menu";
import { ProductionReportWorkspace } from "@/features/reports/components/production-report-workspace";
import { ensureProductionReport } from "@/features/reports/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listResourceCategories } from "@/features/resources/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function ProductionReportDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("report:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к отчётам</p>;
  }

  const [bundle, resourceCategories] = await Promise.all([
    ensureProductionReport(projectId, dayId),
    listResourceCategories(projectId),
  ]);
  if (!bundle) notFound();

  const canEdit = ctx.can("report:write") || ctx.can("schedule:write");

  return (
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
  );
}
