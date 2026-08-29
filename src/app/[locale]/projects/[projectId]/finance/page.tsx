import { FinanceWorkspace } from "@/features/finance/components/finance-workspace";
import {
  listActorsBrief,
  listFinanceOperations,
} from "@/features/finance/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function FinancePage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const [operations, actors] = await Promise.all([
    listFinanceOperations(projectId),
    listActorsBrief(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">
          Финансовый контроль
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Приходы и расходы · гонорары · контрагенты · валюта:{" "}
          {ctx.project.currency}
        </p>
      </div>

      <FinanceWorkspace
        projectId={projectId}
        currency={ctx.project.currency}
        operations={operations}
        actors={actors}
        canWrite={ctx.can("finance:write")}
      />
    </div>
  );
}
