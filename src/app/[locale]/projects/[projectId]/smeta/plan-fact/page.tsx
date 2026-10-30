import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanFactView } from "@/features/smeta/components/plan-fact-view";
import { canOpenSmeta } from "@/features/smeta/lib/smeta-access";
import {
  getPlanFact,
  listPlanFactDepartments,
  resolvePlanFactFilters,
} from "@/features/smeta/plan-fact-queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function PlanFactPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!canOpenSmeta(ctx)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сметам</p>;
  }

  // Чужой или невидимый цех в адресе — как будто его нет.
  const [filters, departments] = await Promise.all([
    resolvePlanFactFilters(projectId, ctx, {
      departmentId: one(sp.department),
      dateFrom: one(sp.dateFrom),
      dateTo: one(sp.dateTo),
    }),
    listPlanFactDepartments(projectId, ctx),
  ]);
  if (!filters) notFound();

  const report = await getPlanFact(projectId, ctx, filters, departments);

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/projects/${projectId}/smeta`}
        className="text-sm text-[var(--muted-fg)] hover:underline"
      >
        ← Сметы
      </Link>
      <h2 className="font-display text-2xl font-semibold">План/факт</h2>
      <PlanFactView
        projectId={projectId}
        report={report}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        filters={{
          departmentId: filters.departmentId ?? "",
          dateFrom: filters.dateFrom ?? "",
          dateTo: filters.dateTo ?? "",
        }}
      />
    </div>
  );
}
