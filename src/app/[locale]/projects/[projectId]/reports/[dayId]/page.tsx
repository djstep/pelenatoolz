import { notFound } from "next/navigation";
import { ProductionReportView } from "@/features/day-docs/components/production-report-view";
import { getShootDayDocument } from "@/features/day-docs/queries";
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

  const bundle = await getShootDayDocument(projectId, dayId);
  if (!bundle) notFound();

  return (
    <ProductionReportView
      locale={locale}
      projectId={projectId}
      bundle={bundle}
    />
  );
}
