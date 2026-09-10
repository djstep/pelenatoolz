import { ApprovalStatusesWorkspace } from "@/features/finance/components/approval-statuses-workspace";
import { FinanceVariablesWorkspace } from "@/features/finance/components/finance-variables-workspace";
import { listApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import { listFinanceVariables } from "@/features/finance/queries-variables";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function FinanceSettingsPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const canWrite = ctx.can("finance:write");
  const [variables, approvalStatuses] = await Promise.all([
    listFinanceVariables(projectId),
    listApprovalStatuses(projectId),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h2 className="font-display text-2xl font-semibold">
          Финансы · Настройки
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Переменные сметы и справочник статусов согласования документов
        </p>
      </div>

      <FinanceVariablesWorkspace
        projectId={projectId}
        variables={variables}
        canWrite={canWrite}
      />

      <ApprovalStatusesWorkspace
        projectId={projectId}
        statuses={approvalStatuses}
        canWrite={canWrite}
      />
    </div>
  );
}
