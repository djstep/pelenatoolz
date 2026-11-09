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
import { ACTIVE_BUDGET_ITEM } from "@/features/smeta/lib/item-where";
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

// ---------------------------------------------------------------------------
// Справочники для экрана сметы цеха
// ---------------------------------------------------------------------------

export type ItemsDictionaries = {
  /** Статьи шаблона, которые можно взять: действующие и ещё не взятые этим цехом. */
  templates: { id: string; name: string }[];
  expenseTypes: { id: string; name: string; archived: boolean }[];
  paymentForms: { id: string; name: string; defaultTaxPercent: string | null; archived: boolean }[];
};

/**
 * Справочники для ввода строк: только чтение. Архивные типы и формы отдаются, чтобы строки,
 * где они уже стоят, показывались с названием; выбрать их заново экран не даёт.
 */
export async function getItemsDictionaries(projectId: string, budgetId: string): Promise<ItemsDictionaries> {
  const [templates, taken, expenseTypes, paymentForms] = await Promise.all([
    prisma.budgetTemplateArticle.findMany({
      where: { projectId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.budgetArticle.findMany({
      where: { projectId, budgetId, archivedAt: null },
      select: { templateArticleId: true },
    }),
    prisma.projectExpenseType.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, archivedAt: true },
    }),
    prisma.projectPaymentForm.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, defaultTaxPercent: true, archivedAt: true },
    }),
  ]);
  const takenIds = new Set(taken.map((t) => t.templateArticleId));
  return {
    templates: templates.filter((t) => !takenIds.has(t.id)),
    expenseTypes: expenseTypes.map((t) => ({ id: t.id, name: t.name, archived: t.archivedAt !== null })),
    paymentForms: paymentForms.map((f) => ({
      id: f.id,
      name: f.name,
      defaultTaxPercent: f.defaultTaxPercent?.toString() ?? null,
      archived: f.archivedAt !== null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Итоги смет цехов для списка — пересчётом, а не из сохранённых сумм строк
// ---------------------------------------------------------------------------

export type DepartmentItemTotals = {
  /** Итого по действующим строкам с суммой. */
  total: string;
  /** Действующих строк. */
  count: number;
  /** Строк без суммы (не задана переменная, нет кол-ва или ставки): в итог не вошли. */
  incomplete: number;
};

/**
 * Итоги смет по статьям для нескольких цехов: строки считаются заново по действующим
 * значениям переменных (как в дереве сметы). Записи старого табличного формата не входят.
 */
export async function departmentItemTotals(
  projectId: string,
  departmentIds: readonly string[],
): Promise<Map<string, DepartmentItemTotals>> {
  if (departmentIds.length === 0) return new Map();
  const [variables, items] = await Promise.all([
    loadBudgetVariables(projectId),
    prisma.budgetItem.findMany({
      where: {
        projectId,
        departmentId: { in: [...departmentIds] },
        subarticleId: { not: null },
        ...ACTIVE_BUDGET_ITEM,
      },
      select: {
        departmentId: true,
        quantity: true,
        rate: true,
        taxPercent: true,
        multiplier1VariableId: true,
        multiplier1Value: true,
        multiplier2VariableId: true,
        multiplier2Value: true,
        multiplier3VariableId: true,
        multiplier3Value: true,
      },
    }),
  ]);
  const values = variableValueMap(variables);
  const byDepartment = new Map<string, ItemCalc[]>();
  for (const item of items) {
    const calc = calcItem(
      { quantity: item.quantity, rate: item.rate, multipliers: multipliersOf(item), taxPercent: item.taxPercent },
      values,
    );
    const list = byDepartment.get(item.departmentId) ?? [];
    list.push(calc);
    byDepartment.set(item.departmentId, list);
  }
  return new Map(
    [...byDepartment].map(([departmentId, calcs]) => {
      const t = sumCalcs(calcs);
      return [departmentId, { total: t.total.toFixed(2), count: calcs.length, incomplete: t.incomplete }];
    }),
  );
}
