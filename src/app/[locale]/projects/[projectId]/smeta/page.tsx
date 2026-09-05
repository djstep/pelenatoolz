import { SmetaWorkspace } from "@/features/smeta/components/smeta-workspace";
import {
  getBudgetForProject,
  getOrCreateBudget,
  listBudgets,
} from "@/features/smeta/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ budgetId?: string }>;
};

export default async function SmetaPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const { budgetId } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  // Смета: фин. условия (financeRead / financeWrite) в матрице раздела «Смета»
  if (!ctx.can("budget:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к смете</p>;
  }

  const budgets = await listBudgets(projectId);
  let budget =
    budgetId != null
      ? await getBudgetForProject(projectId, budgetId)
      : null;

  if (!budget) {
    budget = await getOrCreateBudget(projectId, ctx.user.id);
  }

  const list =
    budgets.some((b) => b.id === budget.id)
      ? budgets
      : [
          {
            id: budget.id,
            name: budget.name,
            createdAt: budget.createdAt,
            updatedAt: budget.updatedAt,
          },
          ...budgets,
        ];

  return (
    <SmetaWorkspace
      projectId={projectId}
      budget={budget}
      budgets={list}
      canWrite={ctx.can("budget:write")}
    />
  );
}
