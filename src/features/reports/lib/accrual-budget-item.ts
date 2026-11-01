import { AccrualReportPart, type ProductionWorkKind } from "@prisma/client";

/**
 * Статья сметы начисления из отчёта смены — чистые функции (без базы), их вызывает
 * `syncReportAccruals`.
 * - Актёр / ресурс / объект: статья по умолчанию с карточки (переработка и км — свои,
 *   если заданы). Пересчёт меняет статью, пока начисление не правили руками.
 * - Спецтранспорт: статья — снимок в строке отчёта (`row.budgetItemId`) и только при
 *   создании начисления. У существующих начислений статья не меняется никогда (в том
 *   числе «без статьи» остаётся без статьи).
 */

type BudgetSource = {
  defaultBudgetItemId: string | null;
  overtimeBudgetItemId: string | null;
};

export type AccrualBudgetRow = {
  kind: ProductionWorkKind;
  /** Снимок статьи строки спецтранспорта */
  budgetItemId: string | null;
  actor: BudgetSource | null;
  item: (BudgetSource & { mileageBudgetItemId: string | null }) | null;
  location: BudgetSource | null;
};

/** Статья с карточки для части оплаты: переработка и км — свои, если заданы, иначе основная. */
export function budgetItemFor(row: AccrualBudgetRow, part: AccrualReportPart): string | null {
  const source = row.actor ?? row.item ?? row.location;
  if (!source) return null;
  const main = source.defaultBudgetItemId;
  if (part === AccrualReportPart.OVERTIME) return source.overtimeBudgetItemId ?? main;
  if (part === AccrualReportPart.MILEAGE) {
    return (row.item ? row.item.mileageBudgetItemId : null) ?? main;
  }
  return main;
}

/** Статья нового начисления. */
export function budgetItemOnCreate(
  row: AccrualBudgetRow,
  part: AccrualReportPart,
): string | null {
  if (row.kind === "TRANSPORT") return row.budgetItemId;
  return budgetItemFor(row, part);
}

/**
 * Статья при пересчёте существующего начисления: новое значение или undefined —
 * не менять. Спецтранспорт — никогда; остальные — если не правили руками и статья
 * с карточки другая.
 */
export function budgetItemOnUpdate(
  accrual: { budgetItemId: string | null; editedManually: boolean },
  row: AccrualBudgetRow,
  part: AccrualReportPart,
): string | null | undefined {
  if (row.kind === "TRANSPORT") return undefined;
  if (accrual.editedManually) return undefined;
  const next = budgetItemFor(row, part);
  return accrual.budgetItemId !== next ? next : undefined;
}
