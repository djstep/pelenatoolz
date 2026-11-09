import "server-only";

import { BudgetStatus, BudgetVersionFormat, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, type AuditContext } from "@/shared/audit/with-audit";
import { lastVersion, loadItemsSnapshot, versionSources } from "@/features/smeta/approval-queries";
import { loadBudgetVariables, variableValueMap } from "@/features/smeta/items-queries";
import { diffBudget } from "@/features/smeta/lib/budget-diff";
import { snapshotDiffSources } from "@/features/smeta/lib/items-snapshot";
import { calcItem, multipliersOf } from "@/features/smeta/lib/item-calc";
import { isItemArchived } from "@/features/smeta/lib/item-where";
import { lockBudget, type Tx } from "@/features/smeta/queries";

/** Строки сметы по статьям, где хоть один множитель — переменная. */
const USES_VARIABLE: Prisma.BudgetItemWhereInput = {
  subarticleId: { not: null },
  OR: [
    { multiplier1VariableId: { not: null } },
    { multiplier2VariableId: { not: null } },
    { multiplier3VariableId: { not: null } },
  ],
};

function money(value: Prisma.Decimal | null): Prisma.Decimal {
  return new Prisma.Decimal(value?.toFixed(2) ?? 0);
}

/**
 * Значения переменных изменились (сама переменная или СМЕНЫ/СЕРИИ из параметров проекта):
 * пересчитать сохранённые суммы строк смет по статьям. Утверждённые версии не трогаются.
 * Статус сметы — по сравнению с последней утверждённой версией: отличается — «утверждённая»
 * становится черновиком (пометка «изменилась после утверждения» считается по версии); снова
 * совпадает (переменную вернули) — черновик опять «утверждена». Смета на утверждении остаётся
 * на утверждении: продюсер видит пересчитанные суммы, утверждение сверяет отпечаток.
 * Вызывать в той же транзакции, где меняется значение, — после изменения.
 */
export async function recalcItemsAfterVariables(
  tx: Tx,
  ctx: AuditContext,
  projectId: string,
  reason: string,
): Promise<number> {
  // Сначала — блокировка всех смет проекта по порядку id (как правка строки блокирует свою смету):
  // после неё никакая правка строк не проскочит между выборкой и пересчётом.
  const budgets = await tx.budget.findMany({
    where: { projectId },
    orderBy: { id: "asc" },
    select: { id: true, departmentId: true, department: { select: { name: true } } },
  });
  for (const budget of budgets) await lockBudget(tx, budget.id);
  const values = variableValueMap(await loadBudgetVariables(projectId, tx));

  let changedBudgets = 0;
  for (const budget of budgets) {
    const items = await tx.budgetItem.findMany({
      where: { projectId, departmentId: budget.departmentId, ...USES_VARIABLE },
      select: {
        id: true,
        quantity: true,
        rate: true,
        taxPercent: true,
        amount: true,
        tax: true,
        total: true,
        archivedAt: true,
        multiplier1VariableId: true,
        multiplier1Value: true,
        multiplier2VariableId: true,
        multiplier2Value: true,
        multiplier3VariableId: true,
        multiplier3Value: true,
        subarticle: { select: { archivedAt: true, article: { select: { archivedAt: true } } } },
      },
    });
    if (items.length === 0) continue;
    let activeChanged = false;
    for (const item of items) {
      const calc = calcItem(
        { quantity: item.quantity, rate: item.rate, multipliers: multipliersOf(item), taxPercent: item.taxPercent },
        values,
      );
      const next = { amount: money(calc.amount), tax: money(calc.tax), total: money(calc.total) };
      if (next.amount.equals(item.amount) && next.tax.equals(item.tax) && next.total.equals(item.total)) continue;
      await tx.budgetItem.update({ where: { id: item.id }, data: next });
      if (!isItemArchived(item)) activeChanged = true;
    }

    const current = await tx.budget.findUniqueOrThrow({
      where: { id: budget.id },
      select: { status: true, changedAfterSubmitAt: true },
    });
    // Совпадает ли черновик с последней утверждённой версией (суммы и множители со значениями).
    let status: BudgetStatus = current.status;
    const last = await lastVersion(tx, projectId, budget.departmentId);
    if (last?.format === BudgetVersionFormat.ITEMS) {
      const draft = await loadItemsSnapshot(tx, projectId, budget.id);
      const same = diffBudget(versionSources(last), snapshotDiffSources(draft)).empty;
      if (!same && current.status === BudgetStatus.APPROVED) status = BudgetStatus.DRAFT;
      if (same && current.status === BudgetStatus.DRAFT && !current.changedAfterSubmitAt) status = BudgetStatus.APPROVED;
    }
    if (!activeChanged && status === current.status) continue;

    changedBudgets++;
    const note =
      status === current.status
        ? ""
        : status === BudgetStatus.DRAFT
          ? " — изменилась после утверждения, статус «черновик»"
          : ` — совпадает с утверждённой версией ${last!.number}, статус «утверждена»`;
    await auditMutation(
      ctx,
      () =>
        tx.budget.update({
          where: { id: budget.id },
          data: { revision: { increment: 1 }, ...(status !== current.status ? { status } : {}) },
          select: { id: true },
        }),
      undefined,
      {
        projectId,
        entityType: AuditEntityType.budget,
        action: "UPDATE",
        entityId: budget.id,
        summary: `Смета цеха «${budget.department.name}» пересчитана: ${reason}${note}`,
      },
      { db: tx },
    );
  }
  return changedBudgets;
}

/** После пересчёта — обновить экраны смет. */
export function revalidateSmetaPages(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/smeta`, "layout");
}
