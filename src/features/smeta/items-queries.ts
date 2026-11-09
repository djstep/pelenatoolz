import "server-only";

import { Prisma } from "@prisma/client";
import { effectiveVariableValue } from "@/features/finance/lib/variable-values";
import {
  calcItem,
  multipliersOf,
  sumCalcs,
  sumTotals,
  type ItemCalc,
  type ItemProblem,
  type Totals,
  type VariableValues,
} from "@/features/smeta/lib/item-calc";
import { prisma } from "@/shared/db/prisma";

type Db = { project: Pick<typeof prisma.project, "findUnique">; projectFinanceVariable: Pick<typeof prisma.projectFinanceVariable, "findMany"> };

export type BudgetVariable = {
  id: string;
  key: string;
  label: string;
  /** Действующее значение строкой; null — не задано. */
  value: string | null;
};

/** Переменные проекта с действующими значениями (одно правило — `effectiveVariableValue`). */
export async function loadBudgetVariables(projectId: string, db: Db = prisma): Promise<BudgetVariable[]> {
  const [project, rows] = await Promise.all([
    db.project.findUnique({
      where: { id: projectId },
      select: { shootingDaysCount: true, episodeCount: true },
    }),
    db.projectFinanceVariable.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, key: true, label: true, value: true },
    }),
  ]);
  if (!project) return [];
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    value: effectiveVariableValue(r, project),
  }));
}

export function variableValueMap(variables: readonly BudgetVariable[]): VariableValues {
  return new Map(variables.map((v) => [v.id, v.value]));
}

// ---------------------------------------------------------------------------
// Дерево сметы цеха: статья → подстатья → строки, с расчётом и итогами
// ---------------------------------------------------------------------------

export type MoneyTotals = { amount: string; tax: string; total: string; incomplete: number };

export type TreeLine = {
  id: string;
  name: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  multipliers: ({ variableId: string } | { value: string } | null)[];
  expenseTypeId: string | null;
  paymentFormId: string | null;
  taxPercent: string | null;
  archived: boolean;
  amount: string | null;
  tax: string | null;
  total: string | null;
  problems: ItemProblem[];
};

export type TreeSubarticle = {
  id: string;
  name: string;
  archived: boolean;
  totals: MoneyTotals;
  lines: TreeLine[];
};

export type TreeArticle = {
  id: string;
  templateArticleId: string;
  name: string;
  archived: boolean;
  totals: MoneyTotals;
  subarticles: TreeSubarticle[];
};

export type DepartmentItemsTree = {
  budgetId: string;
  articles: TreeArticle[];
  /** Итог сметы цеха — по действующим (не архивным) строкам. */
  totals: MoneyTotals;
  variables: BudgetVariable[];
};

function serializeTotals(t: Totals): MoneyTotals {
  return { amount: t.amount.toFixed(2), tax: t.tax.toFixed(2), total: t.total.toFixed(2), incomplete: t.incomplete };
}

function str(value: Prisma.Decimal | null): string | null {
  return value == null ? null : value.toString();
}

/**
 * Дерево сметы цеха из новой модели. Порядок статей — как в шаблоне, подстатей и строк — свой.
 * Итоги считаются заново по действующим значениям переменных; архивные строки, подстатьи
 * и статьи в итоги не входят. Внутренние коды и номера не отдаются.
 */
export async function getDepartmentItemsTree(
  projectId: string,
  departmentId: string,
): Promise<DepartmentItemsTree | null> {
  const budget = await prisma.budget.findFirst({
    where: { projectId, departmentId },
    select: { id: true },
  });
  if (!budget) return null;

  const [variables, articles] = await Promise.all([
    loadBudgetVariables(projectId),
    prisma.budgetArticle.findMany({
      where: { projectId, budgetId: budget.id },
      orderBy: [{ templateArticle: { sortOrder: "asc" } }, { templateArticle: { number: "asc" } }],
      select: {
        id: true,
        templateArticleId: true,
        archivedAt: true,
        templateArticle: { select: { name: true } },
        subarticles: {
          orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
          select: {
            id: true,
            name: true,
            archivedAt: true,
            items: {
              orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
              select: {
                id: true,
                name: true,
                unit: true,
                quantity: true,
                rate: true,
                taxPercent: true,
                expenseTypeId: true,
                paymentFormId: true,
                archivedAt: true,
                multiplier1VariableId: true,
                multiplier1Value: true,
                multiplier2VariableId: true,
                multiplier2Value: true,
                multiplier3VariableId: true,
                multiplier3Value: true,
              },
            },
          },
        },
      },
    }),
  ]);
  const values = variableValueMap(variables);

  const articleTotals: Totals[] = [];
  const tree: TreeArticle[] = articles.map((article) => {
    const subTotals: Totals[] = [];
    const subarticles: TreeSubarticle[] = article.subarticles.map((sub) => {
      const active: ItemCalc[] = [];
      const lines: TreeLine[] = sub.items.map((item) => {
        const multipliers = multipliersOf(item);
        const calc = calcItem(
          { quantity: item.quantity, rate: item.rate, multipliers, taxPercent: item.taxPercent },
          values,
        );
        if (item.archivedAt === null) active.push(calc);
        return {
          id: item.id,
          name: item.name,
          unit: item.unit,
          quantity: str(item.quantity),
          rate: str(item.rate),
          multipliers: multipliers.map((m) =>
            m == null ? null : "variableId" in m ? { variableId: m.variableId } : { value: m.value.toString() },
          ),
          expenseTypeId: item.expenseTypeId,
          paymentFormId: item.paymentFormId,
          taxPercent: str(item.taxPercent),
          archived: item.archivedAt !== null,
          amount: calc.amount?.toFixed(2) ?? null,
          tax: calc.tax?.toFixed(2) ?? null,
          total: calc.total?.toFixed(2) ?? null,
          problems: calc.problems,
        };
      });
      const totals = sumCalcs(active);
      if (sub.archivedAt === null) subTotals.push(totals);
      return {
        id: sub.id,
        name: sub.name,
        archived: sub.archivedAt !== null,
        totals: serializeTotals(totals),
        lines,
      };
    });
    const totals = sumTotals(subTotals);
    if (article.archivedAt === null) articleTotals.push(totals);
    return {
      id: article.id,
      templateArticleId: article.templateArticleId,
      name: article.templateArticle.name,
      archived: article.archivedAt !== null,
      totals: serializeTotals(totals),
      subarticles,
    };
  });

  return {
    budgetId: budget.id,
    articles: tree,
    totals: serializeTotals(sumTotals(articleTotals)),
    variables,
  };
}
