import { PaymentsWorkspace } from "@/features/payments/components/payments-workspace";
import {
  cashPaymentTotals,
  listCashPayments,
} from "@/features/payments/queries";
import {
  listCompanyOptions,
  listCounterpartyOptions,
} from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  describeBudgetItems,
  listVisibleBudgetItems,
  visibleDepartments,
} from "@/features/smeta/budget-item-access";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{
    q?: string;
    dateFrom?: string;
    dateTo?: string;
    budgetItemId?: string;
    counterpartyId?: string;
    companyId?: string;
    locked?: string;
  }>;
};

export default async function PaymentsPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
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
    budgetItemId: sp.budgetItemId ?? "",
    counterpartyId: sp.counterpartyId ?? "",
    companyId: sp.companyId ?? "",
    locked: sp.locked ?? "",
  };

  const queryFilters = {
    q: filters.q || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    budgetItemId: filters.budgetItemId || undefined,
    counterpartyId: filters.counterpartyId || undefined,
    companyId: filters.companyId || undefined,
    locked:
      filters.locked === "yes" || filters.locked === "no"
        ? (filters.locked as "yes" | "no")
        : undefined,
  };

  const [payments, items, counterparties, companies] = await Promise.all([
    listCashPayments(projectId, visibleDepartments(ctx), queryFilters),
    listVisibleBudgetItems(projectId, ctx),
    listCounterpartyOptions(projectId),
    listCompanyOptions(projectId),
  ]);
  const itemLabels = await describeBudgetItems(projectId, ctx, [
    ...payments.flatMap((p) => p.breakdown.map((b) => b.budgetItemId)),
    filters.budgetItemId,
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
        locale={locale}
        currency={ctx.project.currency}
        payments={payments}
        items={items}
        itemLabels={itemLabels}
        counterparties={counterparties}
        companies={companies}
        filters={filters}
        totals={cashPaymentTotals(payments)}
        canWrite={ctx.can("finance:write")}
        canUnlock={ctx.can("finance:unlock")}
      />
    </div>
  );
}
