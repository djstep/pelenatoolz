import { notFound } from "next/navigation";
import { ProductionReportWorkspace } from "@/features/reports/components/production-report-workspace";
import { ensureProductionReport } from "@/features/reports/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; dayId: string }>;
};

export default async function ProductionReportDayPage({ params }: Props) {
  const { locale, projectId, dayId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("report:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к отчётам</p>;
  }

  const bundle = await ensureProductionReport(projectId, dayId);
  if (!bundle) notFound();

  const canEdit = ctx.can("report:write") || ctx.can("schedule:write");

  return (
    <ProductionReportWorkspace
      locale={locale}
      projectId={projectId}
      bundle={bundle}
      canEdit={canEdit}
    />
  );
}
