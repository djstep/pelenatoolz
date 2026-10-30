import { AccrualsWorkspace } from "@/features/accruals/components/accruals-workspace";
import {
  accrualTotals,
  listAccruals,
  listProjectGroupUnits,
  listShootDaysBrief,
} from "@/features/accruals/queries";
import { listCounterpartyOptions } from "@/features/counterparties/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  describeBudgetItems,
  listVisibleBudgetItems,
  visibleDepartments,
} from "@/features/smeta/budget-item-access";
import Link from "next/link";
import { Button } from "@/shared/ui/button";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{
    q?: string;
    dateFrom?: string;
    dateTo?: string;
    budgetItemId?: string;
    counterpartyId?: string;
    groupUnit?: string;
    create?: string;
  }>;
};

export default async function AccrualsPage({ params, searchParams }: Props) {
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
    groupUnit: sp.groupUnit ?? "",
  };

  const [accruals, items, counterparties, shootDays, groupUnits] =
    await Promise.all([
      listAccruals(projectId, visibleDepartments(ctx), {
        q: filters.q || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        budgetItemId: filters.budgetItemId || undefined,
        counterpartyId: filters.counterpartyId || undefined,
        groupUnit: filters.groupUnit || undefined,
      }),
      listVisibleBudgetItems(projectId, ctx),
      listCounterpartyOptions(projectId),
      listShootDaysBrief(projectId),
      listProjectGroupUnits(projectId),
    ]);
  const itemLabels = await describeBudgetItems(
    projectId,
    ctx,
    [...accruals.map((a) => a.budgetItemId), filters.budgetItemId],
  );

  const initialCreate =
    sp.create === "shift"
      ? "PER_SHIFT"
      : sp.create === "one"
        ? "ONE_TIME"
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold">Начисления</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Фактически понесённые расходы (метод начисления) · валюта:{" "}
            {ctx.project.currency}
          </p>
        </div>
        {ctx.can("finance:write") ? (
          <Link
            href={`/${locale}/projects/${projectId}/accruals/shift-entry`}
          >
            <Button variant="secondary">Ввод посменных расходов</Button>
          </Link>
        ) : null}
      </div>

      <AccrualsWorkspace
        projectId={projectId}
        currency={ctx.project.currency}
        accruals={accruals}
        items={items}
        itemLabels={itemLabels}
        counterparties={counterparties}
        shootDays={shootDays}
        groupUnits={groupUnits}
        filters={filters}
        totals={accrualTotals(accruals)}
        canWrite={ctx.can("finance:write")}
        initialCreate={initialCreate}
      />
    </div>
  );
}
