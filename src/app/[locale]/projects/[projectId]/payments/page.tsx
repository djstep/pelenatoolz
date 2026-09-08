import { PaymentsWorkspace } from "@/features/payments/components/payments-workspace";
import {
  getCashPaymentTotals,
  listCashPayments,
} from "@/features/payments/queries";
import { listBudgetLinesForAccrual } from "@/features/accruals/queries";
import {
  listCompanyOptions,
  listCounterpartyOptions,
} from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{
    q?: string;
    dateFrom?: string;
    dateTo?: string;
    budgetLineId?: string;
    counterpartyId?: string;
    companyId?: string;
    locked?: string;
  }>;
};

export default async function PaymentsPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("finance:read")) {
    return (
      <p className="text-sm text-[var(--danger)]">Нет доступа к финансам</p>
    );
  }

  const filters = {
    q: sp.q ?? "",
    dateFrom: sp.dateFrom ?? "",
    dateTo: sp.dateTo ?? "",
    budgetLineId: sp.budgetLineId ?? "",
    counterpartyId: sp.counterpartyId ?? "",
    companyId: sp.companyId ?? "",
    locked: sp.locked ?? "",
  };

  const queryFilters = {
    q: filters.q || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    budgetLineId: filters.budgetLineId || undefined,
    counterpartyId: filters.counterpartyId || undefined,
    companyId: filters.companyId || undefined,
    locked:
      filters.locked === "yes" || filters.locked === "no"
        ? (filters.locked as "yes" | "no")
        : undefined,
  };

  const [payments, totals, lines, counterparties, companies] =
    await Promise.all([
      listCashPayments(projectId, queryFilters),
      getCashPaymentTotals(projectId, queryFilters),
      listBudgetLinesForAccrual(projectId),
      listCounterpartyOptions(projectId),
      listCompanyOptions(projectId),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Платежи</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Фактическое движение денег (кассовый метод) · отдельно от начислений ·
          валюта: {ctx.project.currency}
        </p>
      </div>

      <PaymentsWorkspace
        projectId={projectId}
        currency={ctx.project.currency}
        payments={payments}
        lines={lines}
        counterparties={counterparties}
        companies={companies}
        filters={filters}
        totals={totals}
        canWrite={ctx.can("finance:write")}
        canUnlock={ctx.can("finance:unlock")}
      />
    </div>
  );
}
