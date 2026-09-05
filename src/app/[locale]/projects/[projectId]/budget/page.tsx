import { BudgetWorkspace } from "@/features/budget/components/budget-workspace";
import { listBudgetLines } from "@/features/budget/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function BudgetPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("budget:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к смете</p>;
  }

  const lines = await listBudgetLines(projectId);
  const canWrite = ctx.can("budget:write");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Статьи бюджета</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          План / факт по категориям · табличная смета — в разделе «Смета» · валюта:{" "}
          {ctx.project.currency}
        </p>
      </div>

      <BudgetWorkspace
        projectId={projectId}
        currency={ctx.project.currency}
        lines={lines}
        canWrite={canWrite}
      />
    </div>
  );
}
