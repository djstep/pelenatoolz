import "server-only";

import { BudgetStatus, BudgetVersionFormat, Prisma } from "@prisma/client";
import { listDepartmentsForSmeta } from "@/features/departments/queries";
import { loadItemsSnapshot } from "@/features/smeta/approval-queries";
import { parseItemsSnapshot, snapshotMultipliersText, type ItemsSnapshot } from "@/features/smeta/lib/items-snapshot";
import { addMoney, percentOf, type SummaryMoney } from "@/features/smeta/lib/summary-money";
import { prisma } from "@/shared/db/prisma";

export type { SummaryMoney };

/**
 * Сводная продюсера по сметам цехов по статьям: по цехам и по статьям шаблона (одинаковые статьи
 * разных цехов складываются), с раскрытием до подстатей и строк, итогами на каждом уровне,
 * резервом и агентскими. Суммы — из снимков утверждённых версий или (черновики) пересчётом
 * по действующим значениям переменных, не из сохранённых сумм строк. Внутренние коды наружу
 * не отдаются. Права (продюсер или «Сметы — просмотр всех») проверяет вызывающий.
 */

const D = Prisma.Decimal;

export type SummaryLine = {
  id: string;
  name: string;
  unit: string | null;
  quantity: string | null;
  rate: string | null;
  multipliers: string;
  taxPercent: string | null;
  amount: string | null;
  tax: string | null;
  total: string | null;
};

export type SummarySub = { id: string; name: string; totals: SummaryMoney; lines: SummaryLine[] };

/** Статья шаблона в цехе. «__sheet» — версия старого табличного формата (без статей шаблона). */
export type SummaryDeptArticle = { key: string; name: string; totals: SummaryMoney; subarticles: SummarySub[] };

export type SummaryDepartment = {
  id: string;
  name: string;
  /** Утверждённые: номер версии (null — версий нет). Черновики: номер последней версии. */
  versionNumber: number | null;
  status: BudgetStatus | null;
  /** Строк без суммы (только черновики): в итог не вошли. */
  incomplete: number;
  totals: SummaryMoney;
  articles: SummaryDeptArticle[];
};

export type SummaryArticle = {
  key: string;
  name: string;
  totals: SummaryMoney;
  departments: { id: string; name: string; totals: SummaryMoney; subarticles: SummarySub[] }[];
};

export type ItemsSummary = {
  mode: "versions" | "drafts";
  departments: SummaryDepartment[];
  articles: SummaryArticle[];
  /** Итого по цехам (с налогом). */
  subtotal: SummaryMoney;
  reserve: { percent: string; amount: string };
  agency: { percent: string; amount: string };
  /** Итого по проекту: цеха + резерв + агентские. */
  total: string;
};

export const SHEET_ARTICLE_KEY = "__sheet";
const SHEET_ARTICLE_NAME = "Прежняя таблица (до сметы по статьям)";

const ZERO: SummaryMoney = { amount: "0.00", tax: "0.00", total: "0.00" };

function money(t: { amount: string; tax: string; total: string }): SummaryMoney {
  return { amount: t.amount, tax: t.tax, total: t.total };
}

/** Статьи цеха из снимка: без кодов, множители — текстом со значениями снимка. */
function snapshotArticles(snapshot: ItemsSnapshot): SummaryDeptArticle[] {
  return snapshot.articles.map((a) => ({
    key: a.templateArticleId,
    name: a.name,
    totals: money(a.totals),
    subarticles: a.subarticles.map((s) => ({
      id: s.id,
      name: s.name,
      totals: money(s.totals),
      lines: s.lines.map((l) => ({
        id: l.id,
        name: l.name,
        unit: l.unit,
        quantity: l.quantity,
        rate: l.rate,
        multipliers: snapshotMultipliersText(l.multipliers),
        taxPercent: l.taxPercent,
        amount: l.amount,
        tax: l.tax,
        total: l.total,
      })),
    })),
  }));
}

type SheetLine = {
  budgetItemId: string;
  name: string;
  unit: string | null;
  quantity: Prisma.Decimal | null;
  rate: Prisma.Decimal | null;
  taxPercent: Prisma.Decimal | null;
  amount: Prisma.Decimal;
  tax: Prisma.Decimal;
  total: Prisma.Decimal;
};

/** Старая версия (табличный формат): одна «статья» со строками как в плане. */
function sheetArticles(versionId: string, lines: readonly SheetLine[]): SummaryDeptArticle[] {
  if (lines.length === 0) return [];
  const rows: SummaryLine[] = lines.map((l) => ({
    id: l.budgetItemId,
    name: l.name,
    unit: l.unit,
    quantity: l.quantity?.toString() ?? null,
    rate: l.rate?.toString() ?? null,
    multipliers: "",
    taxPercent: l.taxPercent?.toString() ?? null,
    amount: l.amount.toFixed(2),
    tax: l.tax.toFixed(2),
    total: l.total.toFixed(2),
  }));
  const totals = addMoney(rows.map((r) => ({ amount: r.amount!, tax: r.tax!, total: r.total! })));
  return [
    {
      key: SHEET_ARTICLE_KEY,
      name: SHEET_ARTICLE_NAME,
      totals,
      subarticles: [{ id: `sheet-${versionId}`, name: "Статьи", totals, lines: rows }],
    },
  ];
}

export async function getItemsSummary(projectId: string, opts: { drafts: boolean }): Promise<ItemsSummary> {
  const departments = await listDepartmentsForSmeta(projectId, null);
  const ids = departments.map((d) => d.id);
  const [budgets, versions, templates, settings] = await Promise.all([
    prisma.budget.findMany({
      where: { projectId, departmentId: { in: ids } },
      select: { id: true, departmentId: true, status: true },
    }),
    prisma.budgetVersion.findMany({
      where: { projectId, departmentId: { in: ids } },
      orderBy: [{ departmentId: "asc" }, { number: "desc" }],
      distinct: ["departmentId"],
      select: {
        id: true,
        departmentId: true,
        number: true,
        format: true,
        // Снимок и строки нужны только для утверждённых: у черновиков считаем заново.
        snapshot: !opts.drafts,
        lines: opts.drafts
          ? false
          : {
              orderBy: { sortOrder: "asc" },
              select: {
                budgetItemId: true,
                name: true,
                unit: true,
                quantity: true,
                rate: true,
                taxPercent: true,
                amount: true,
                tax: true,
                total: true,
              },
            },
      },
    }),
    prisma.budgetTemplateArticle.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.projectBudgetSettings.findUnique({ where: { projectId }, select: { reservePercent: true, agencyPercent: true } }),
  ]);
  const budgetBy = new Map(budgets.map((b) => [b.departmentId, b]));
  const versionBy = new Map(versions.map((v) => [v.departmentId, v]));

  const summaryDepartments: SummaryDepartment[] = [];
  for (const d of departments) {
    const budget = budgetBy.get(d.id) ?? null;
    const version = versionBy.get(d.id) ?? null;
    let articles: SummaryDeptArticle[] = [];
    let totals = ZERO;
    let incomplete = 0;
    if (opts.drafts) {
      if (budget) {
        const snapshot = await loadItemsSnapshot(prisma, projectId, budget.id);
        articles = snapshotArticles(snapshot);
        totals = money(snapshot.totals);
        incomplete = snapshot.totals.incomplete;
      }
    } else if (version) {
      if (version.format === BudgetVersionFormat.ITEMS) {
        const snapshot = parseItemsSnapshot(version.snapshot);
        if (snapshot) {
          articles = snapshotArticles(snapshot);
          totals = money(snapshot.totals);
        }
      } else {
        articles = sheetArticles(version.id, version.lines ?? []);
        totals = articles[0]?.totals ?? ZERO;
      }
    }
    summaryDepartments.push({
      id: d.id,
      name: d.name,
      versionNumber: version?.number ?? null,
      status: budget?.status ?? null,
      incomplete,
      totals,
      articles,
    });
  }

  // По статьям шаблона: порядок — как в шаблоне; старые таблицы — в конце.
  const order = new Map(templates.map((t, i) => [t.id, i]));
  const names = new Map(templates.map((t) => [t.id, t.name]));
  const byKey = new Map<string, SummaryArticle>();
  for (const d of summaryDepartments) {
    for (const a of d.articles) {
      const entry =
        byKey.get(a.key) ??
        ({ key: a.key, name: names.get(a.key) ?? a.name, totals: ZERO, departments: [] } satisfies SummaryArticle);
      entry.departments.push({ id: d.id, name: d.name, totals: a.totals, subarticles: a.subarticles });
      byKey.set(a.key, entry);
    }
  }
  const articles = [...byKey.values()]
    .map((a) => ({ ...a, totals: addMoney(a.departments.map((d) => d.totals)) }))
    .sort((x, y) => (order.get(x.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(y.key) ?? Number.MAX_SAFE_INTEGER));

  const subtotal = addMoney(summaryDepartments.map((d) => d.totals));
  const reservePercent = settings?.reservePercent.toString() ?? "0";
  const agencyPercent = settings?.agencyPercent.toString() ?? "0";
  const reserve = percentOf(subtotal.total, reservePercent);
  const agency = percentOf(subtotal.total, agencyPercent);
  return {
    mode: opts.drafts ? "drafts" : "versions",
    departments: summaryDepartments,
    articles,
    subtotal,
    reserve: { percent: reservePercent, amount: reserve },
    agency: { percent: agencyPercent, amount: agency },
    total: new D(subtotal.total).plus(reserve).plus(agency).toFixed(2),
  };
}
