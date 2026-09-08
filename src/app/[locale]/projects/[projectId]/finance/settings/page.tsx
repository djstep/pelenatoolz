import { FinanceVariablesWorkspace } from "@/features/finance/components/finance-variables-workspace";
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

  const variables = await listFinanceVariables(projectId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">
          Финансы · Настройки
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Переменные для расчёта количества в статьях сметы
        </p>
      </div>

      <FinanceVariablesWorkspace
        projectId={projectId}
        variables={variables}
        canWrite={ctx.can("finance:write")}
      />
    </div>
  );
}
