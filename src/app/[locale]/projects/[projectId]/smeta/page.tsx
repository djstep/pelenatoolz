import { CreateSmetaWizard } from "@/features/smeta/components/create-smeta-wizard";
import { SmetaWorkspace } from "@/features/smeta/components/smeta-workspace";
import {
  getBudgetForProject,
  listBudgets,
  listBudgetTemplates,
} from "@/features/smeta/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listDepartmentsForSmeta } from "@/features/departments/queries";
import {
  canOpenSmeta,
  canReadAllSmeta,
  canUseLegacySmeta,
} from "@/features/smeta/lib/smeta-access";
import { Card } from "@/shared/ui/card";

async function DepartmentSmetaList({
  projectId,
  onlyIds,
}: {
  projectId: string;
  onlyIds: readonly string[] | null;
}) {
  const departments = await listDepartmentsForSmeta(projectId, onlyIds);
  return (
    <Card>
      <h3 className="font-display text-lg font-semibold">Сметы цехов</h3>
      {departments.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted-fg)]">
          Цехов пока нет. Их создаёт продюсер в разделе «Настройки → Цеха».
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]/60">
          {departments.map((department) => (
            <li
              key={department.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
            >
              <span className="font-medium">{department.name}</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-[var(--muted-fg)]">
                  {department.codePrefix}
                </span>
                <span className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted-fg)]">
                  смета ещё не создана
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ budgetId?: string; create?: string }>;
};

export default async function SmetaPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { budgetId, create } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!canOpenSmeta(ctx)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сметам</p>;
  }

  // Глава видит только свои цеха, продюсер и флаг «Сметы — просмотр всех» — все.
  const departmentList = (
    <DepartmentSmetaList
      projectId={projectId}
      onlyIds={canReadAllSmeta(ctx) ? null : ctx.headDepartmentIds}
    />
  );

  // Старые книги без цеха, редактор и шаблоны — до шага 2 только продюсер.
  if (!canUseLegacySmeta(ctx)) {
    return (
      <div className="space-y-6">
        <h2 className="font-display text-2xl font-semibold">Сметы</h2>
        {departmentList}
      </div>
    );
  }

  const [budgets, templates] = await Promise.all([
    listBudgets(projectId),
    listBudgetTemplates(projectId),
  ]);

  const canWrite = canUseLegacySmeta(ctx);
  const forceCreate = create === "1" || create === "true";

  let budget =
    budgetId != null
      ? await getBudgetForProject(projectId, budgetId)
      : null;

  if (!budget && !forceCreate && budgets.length > 0) {
    budget = await getBudgetForProject(projectId, budgets[0]!.id);
  }

  const showWizard = forceCreate || !budget;

  if (showWizard) {
    return (
      <div className="space-y-6">
        {departmentList}
        <div>
          <h2 className="font-display text-2xl font-semibold">Смета</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Табличный редактор · шаблоны · импорт Excel
          </p>
        </div>
        <CreateSmetaWizard
          projectId={projectId}
          templates={templates}
          canWrite={canWrite}
          cancelHref={
            budgets.length > 0
              ? `/${locale}/projects/${projectId}/smeta?budgetId=${budgets[0]!.id}`
              : undefined
          }
        />
      </div>
    );
  }

  // After wizard branch, budget is guaranteed.
  const active = budget!;
  const list =
    budgets.some((b) => b.id === active.id)
      ? budgets
      : [
          {
            id: active.id,
            name: active.name,
            createdAt: active.createdAt,
            updatedAt: active.updatedAt,
          },
          ...budgets,
        ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {departmentList}
      <SmetaWorkspace
        projectId={projectId}
        budget={active}
        budgets={list}
        canWrite={canWrite}
      />
    </div>
  );
}
