import { CreateSmetaWizard } from "@/features/smeta/components/create-smeta-wizard";
import { SmetaWorkspace } from "@/features/smeta/components/smeta-workspace";
import {
  getBudgetForProject,
  listBudgets,
  listBudgetTemplates,
} from "@/features/smeta/queries";
import { FinanceSectionTabs } from "@/features/finance/components/finance-section-tabs";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ budgetId?: string; create?: string }>;
};

export default async function SmetaPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { budgetId, create } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("budget:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к смете</p>;
  }

  const [budgets, templates] = await Promise.all([
    listBudgets(projectId),
    listBudgetTemplates(projectId),
  ]);

  const canWrite = ctx.can("budget:write");
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
        <div>
          <h2 className="font-display text-2xl font-semibold">Смета</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Табличный редактор · шаблоны · импорт Excel
          </p>
        </div>
        <FinanceSectionTabs locale={locale} projectId={projectId} />
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
    <div className="space-y-4">
      <FinanceSectionTabs locale={locale} projectId={projectId} />
      <SmetaWorkspace
        projectId={projectId}
        budget={active}
        budgets={list}
        canWrite={canWrite}
      />
    </div>
  );
}
