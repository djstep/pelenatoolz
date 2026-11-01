import { UsageLedgerSummary } from "@/features/payroll/components/usage-ledger-summary";
import { listUsageLedgerSummary } from "@/features/payroll/queries-usage-ledger";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canReadAnyEntityFinance } from "@/features/roles/permissions-matrix";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ResourceUsagePage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  // Как пункт меню: в ведомости только суммы, без фин. просмотра источников она не нужна.
  if (!canReadAnyEntityFinance(ctx.matrix, ctx.categoryFinance)) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к ведомости</p>
    );
  }

  const rows = await listUsageLedgerSummary(projectId, locale, {
    canActors: ctx.canFinanceRead("actors"),
    canLocations: ctx.canFinanceRead("locations"),
    canCategory: (categoryId) => ctx.canFinanceRead({ categoryId }),
    // Спецтранспорт дня — как в отчёте смены (`workRowAccess`).
    canTransport: ctx.can("finance:read"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">
          Ведомость по использованию ресурсов
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Сводная стоимость по типам, на которые у вас есть право просмотра
          финансовых условий · {ctx.project.currency}
        </p>
      </div>

      <UsageLedgerSummary rows={rows} currency={ctx.project.currency} />
    </div>
  );
}
