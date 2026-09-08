import {
  CashFlowReportView,
  PlanFactReportView,
} from "@/features/finance/components/finance-reports-workspace";
import {
  getCashFlowReport,
  getPlanFactReport,
} from "@/features/finance/queries-reports";
import {
  listCompanyOptions,
  listCounterpartyOptions,
} from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{
    view?: string;
    dateFrom?: string;
    dateTo?: string;
    companyId?: string;
    counterpartyId?: string;
  }>;
};

export default async function FinanceReportsPage({
  params,
  searchParams,
}: Props) {
  const { locale, projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const view = sp.view === "cash-flow" ? "cash-flow" : "plan-fact";
  const dateFrom = sp.dateFrom ?? "";
  const dateTo = sp.dateTo ?? "";

  if (view === "plan-fact") {
    const report = await getPlanFactReport(projectId, {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-display text-2xl font-semibold">Отчёты</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Сводные управленческие отчёты по начислениям и платежам · валюта:{" "}
            {ctx.project.currency}
          </p>
        </div>
        <PlanFactReportView
          locale={locale}
          projectId={projectId}
          currency={ctx.project.currency}
          report={report}
          filters={{ dateFrom, dateTo }}
        />
      </div>
    );
  }

  const [report, companies, counterparties] = await Promise.all([
    getCashFlowReport(projectId, {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      companyId: sp.companyId || undefined,
      counterpartyId: sp.counterpartyId || undefined,
    }),
    listCompanyOptions(projectId),
    listCounterpartyOptions(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Отчёты</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Сводные управленческие отчёты по начислениям и платежам · валюта:{" "}
          {ctx.project.currency}
        </p>
      </div>
      <CashFlowReportView
        locale={locale}
        projectId={projectId}
        currency={ctx.project.currency}
        report={report}
        filters={{
          dateFrom,
          dateTo,
          companyId: sp.companyId ?? "",
          counterpartyId: sp.counterpartyId ?? "",
        }}
        companies={companies}
        counterparties={counterparties}
      />
    </div>
  );
}
