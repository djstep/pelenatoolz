import { BudgetWorkspace } from "@/features/budget/components/budget-workspace";
import { listBudgetLines } from "@/features/budget/queries";
import {
  listActorsBriefForLink,
  listResourceItemsBriefForLink,
} from "@/features/accruals/queries";
import { listCounterpartyOptions } from "@/features/counterparties/queries";
import { listFinanceVariables } from "@/features/finance/queries-variables";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function BudgetPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("budget:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к смете</p>;
  }

  const [lines, variables, counterparties, actors, resources] =
    await Promise.all([
      listBudgetLines(projectId),
      listFinanceVariables(projectId),
      listCounterpartyOptions(projectId),
      listActorsBriefForLink(projectId),
      listResourceItemsBriefForLink(projectId),
    ]);
  const canWrite = ctx.can("budget:write");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Статьи сметы</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Посменные, разовые и периодические статьи с авторасчётом · валюта:{" "}
          {ctx.project.currency}
        </p>
      </div>

      <BudgetWorkspace
        projectId={projectId}
        currency={ctx.project.currency}
        lines={lines}
        variables={variables}
        counterparties={counterparties}
        actors={actors}
        resources={resources}
        canWrite={canWrite}
      />
    </div>
  );
}
