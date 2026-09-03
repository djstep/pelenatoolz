import { ProductionReportsIndex } from "@/features/reports/components/production-reports-index";
import { listProductionReports } from "@/features/reports/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ReportsPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("report:read") && !ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к отчётам</p>;
  }

  const days = await listProductionReports(projectId);

  return (
    <ProductionReportsIndex locale={locale} projectId={projectId} days={days} />
  );
}
