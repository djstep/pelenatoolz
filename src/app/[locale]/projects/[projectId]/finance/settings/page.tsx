import { ApprovalStatusesWorkspace } from "@/features/finance/components/approval-statuses-workspace";
import { BudgetDictionariesWorkspace } from "@/features/finance/components/budget-dictionaries-workspace";
import { FinanceVariablesWorkspace } from "@/features/finance/components/finance-variables-workspace";
import { listApprovalStatuses } from "@/features/finance/queries-approval-statuses";
import {
  getBudgetPercents,
  listCounterpartyPaymentForms,
  listExpenseTypes,
  listPaymentForms,
} from "@/features/finance/queries-budget-dictionaries";
import { listFinanceVariables } from "@/features/finance/queries-variables";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canEditBudgetDictionaries } from "@/features/smeta/lib/smeta-access";

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
  // Справочники сметы и переменные: продюсер и «Финансы: правка», остальные только видят.
  const canEditDictionaries = canEditBudgetDictionaries(ctx);
  const [variables, approvalStatuses, percents, expenseTypes, paymentForms, mapping] =
    await Promise.all([
      listFinanceVariables(projectId),
      listApprovalStatuses(projectId),
      getBudgetPercents(projectId),
      listExpenseTypes(projectId),
      listPaymentForms(projectId),
      listCounterpartyPaymentForms(projectId),
    ]);

  return (
    <div className="space-y-10">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">
          Финансы · Настройки
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Переменные и справочники сметы, справочник статусов согласования документов
        </p>
      </div>

      <FinanceVariablesWorkspace
        projectId={projectId}
        variables={variables}
        canWrite={canEditDictionaries}
      />

      <BudgetDictionariesWorkspace
        projectId={projectId}
        percents={percents}
        expenseTypes={expenseTypes}
        paymentForms={paymentForms}
        mapping={mapping}
        canEdit={canEditDictionaries}
      />

      <ApprovalStatusesWorkspace
        projectId={projectId}
        statuses={approvalStatuses}
        canWrite={canWrite}
      />
    </div>
  );
}
