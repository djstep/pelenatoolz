import type { DiffSource } from "@/features/smeta/lib/budget-diff";
import {
  calcItem,
  multipliersOf,
  sumCalcs,
  sumTotals,
  type DecimalLike,
  type ItemCalc,
  type ItemProblem,
  type Totals,
} from "@/features/smeta/lib/item-calc";

/**
 * Снимок сметы цеха по статьям для утверждённой версии: статьи → подстатьи → строки с расчётом
 * и значения переменных на момент утверждения. Версия хранит его как есть и больше не меняется.
 * В снимок входят только действующие (не архивные) статьи, подстатьи и строки.
 */

export type SnapshotVariable = { id: string; key: string; label: string; value: string | null };

export type SnapshotMultiplier = { variableId: string; label: string; value: string | null } | { value: string } | null;

export type SnapshotTotals = { amount: string; tax: string; total: string; incomplete: number };

export type SnapshotLine = {
  id: string;
  /** Внутренний код — для плана/факта и выгрузки; на экране не показывается. */
  code: string;
  name: string;
  unit: string | null;
  expenseType: string | null;
  /** Id типа и формы — для сравнения строения (название в справочнике можно переименовать). */
  expenseTypeId?: string | null;
  quantity: string | null;
  rate: string | null;
  multipliers: SnapshotMultiplier[];
  paymentForm: string | null;
  paymentFormId?: string | null;
  taxPercent: string | null;
  amount: string | null;
  tax: string | null;
  total: string | null;
  problems: ItemProblem[];
};

export type SnapshotSubarticle = { id: string; name: string; totals: SnapshotTotals; lines: SnapshotLine[] };

export type SnapshotArticle = {
  id: string;
  templateArticleId: string;
  name: string;
  totals: SnapshotTotals;
  subarticles: SnapshotSubarticle[];
};

export type ItemsSnapshot = {
  version: 1;
  variables: SnapshotVariable[];
  articles: SnapshotArticle[];
  totals: SnapshotTotals;
  lineCount: number;
};

/** Строки, подстатьи и статьи из базы — уже без архивных, в порядке показа. */
export type SnapshotSourceArticle = {
  id: string;
  templateArticleId: string;
  name: string;
  subarticles: {
    id: string;
    name: string;
    items: {
      id: string;
      code: string;
      name: string;
      unit: string | null;
      quantity: DecimalLike | null;
      rate: DecimalLike | null;
      taxPercent: DecimalLike | null;
      expenseType: string | null;
      paymentForm: string | null;
      expenseTypeId?: string | null;
      paymentFormId?: string | null;
      multiplier1VariableId: string | null;
      multiplier1Value: DecimalLike | null;
      multiplier2VariableId: string | null;
      multiplier2Value: DecimalLike | null;
      multiplier3VariableId: string | null;
      multiplier3Value: DecimalLike | null;
    }[];
  }[];
};

function serialize(t: Totals): SnapshotTotals {
  return { amount: t.amount.toFixed(2), tax: t.tax.toFixed(2), total: t.total.toFixed(2), incomplete: t.incomplete };
}

function str(value: DecimalLike | null): string | null {
  return value == null ? null : value.toString();
}

/** Собрать снимок: расчёт строк — тот же, что на экране (`calcItem`), итоги — суммы округлённых строк. */
export function buildItemsSnapshot(articles: readonly SnapshotSourceArticle[], variables: readonly SnapshotVariable[]): ItemsSnapshot {
  const values = new Map(variables.map((v) => [v.id, v.value]));
  const byId = new Map(variables.map((v) => [v.id, v]));
  const articleTotals: Totals[] = [];
  let lineCount = 0;
  const result = articles.map((article): SnapshotArticle => {
    const subTotals: Totals[] = [];
    const subarticles = article.subarticles.map((sub): SnapshotSubarticle => {
      const calcs: ItemCalc[] = [];
      const lines = sub.items.map((item): SnapshotLine => {
        const multipliers = multipliersOf(item);
        const calc = calcItem({ quantity: item.quantity, rate: item.rate, multipliers, taxPercent: item.taxPercent }, values);
        calcs.push(calc);
        lineCount++;
        return {
          id: item.id,
          code: item.code,
          name: item.name,
          unit: item.unit,
          expenseType: item.expenseType,
          expenseTypeId: item.expenseTypeId ?? null,
          quantity: str(item.quantity),
          rate: str(item.rate),
          multipliers: multipliers.map((m) => {
            if (m == null) return null;
            if ("variableId" in m) {
              const v = byId.get(m.variableId);
              return { variableId: m.variableId, label: v?.label ?? "?", value: v?.value ?? null };
            }
            return { value: m.value.toString() };
          }),
          paymentForm: item.paymentForm,
          paymentFormId: item.paymentFormId ?? null,
          taxPercent: str(item.taxPercent),
          amount: calc.amount?.toFixed(2) ?? null,
          tax: calc.tax?.toFixed(2) ?? null,
          total: calc.total?.toFixed(2) ?? null,
          problems: calc.problems,
        };
      });
      const totals = sumCalcs(calcs);
      subTotals.push(totals);
      return { id: sub.id, name: sub.name, totals: serialize(totals), lines };
    });
    const totals = sumTotals(subTotals);
    articleTotals.push(totals);
    return { id: article.id, templateArticleId: article.templateArticleId, name: article.name, totals: serialize(totals), subarticles };
  });
  return {
    version: 1,
    variables: variables.map((v) => ({ ...v })),
    articles: result,
    totals: serialize(sumTotals(articleTotals)),
    lineCount,
  };
}

function formatPlain(value: string): string {
  return value.replace(".", ",");
}

/** «× СМЕНЫ (32) × 0,7» — множители строки снимка текстом, со значениями на момент снимка. */
export function snapshotMultipliersText(multipliers: readonly SnapshotMultiplier[]): string {
  return multipliers
    .flatMap((m) => {
      if (m == null) return [];
      if ("variableId" in m) return [`× ${m.label} (${m.value == null ? "не задана" : formatPlain(m.value)})`];
      return [`× ${formatPlain(m.value)}`];
    })
    .join(" ");
}

function money(value: string | null): number {
  return value == null ? 0 : Number(value);
}

function numOrNull(value: string | null): number | null {
  return value == null ? null : Number(value);
}

/** Строки снимка для сравнения: «статья / подстатья» — место строки, код наружу не идёт. */
export function snapshotDiffSources(snapshot: ItemsSnapshot): DiffSource[] {
  const out: DiffSource[] = [];
  for (const article of snapshot.articles) {
    for (const sub of article.subarticles) {
      for (const line of sub.lines) {
        out.push({
          itemId: line.id,
          code: line.code,
          group: `${article.name} / ${sub.name}`,
          name: line.name,
          unit: line.unit,
          quantity: numOrNull(line.quantity),
          rate: numOrNull(line.rate),
          days: null,
          amount: money(line.amount),
          taxPercent: numOrNull(line.taxPercent),
          tax: money(line.tax),
          total: money(line.total),
          sortOrder: out.length,
          expenseType: line.expenseType,
          multipliers: snapshotMultipliersText(line.multipliers) || null,
          paymentForm: line.paymentForm,
        });
      }
    }
  }
  return out;
}

export type VariableChange = { label: string; before: string | null; after: string | null };

function sameNumber(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a === b;
  return Number(a) === Number(b);
}

/**
 * Какие переменные изменились после утверждения: значения в утверждённой версии ↔ действующие.
 * Только переменные, которые стоят в строках версии или черновика (`used`).
 */
export function changedVariables(
  approved: readonly SnapshotVariable[],
  current: readonly SnapshotVariable[],
  used: ReadonlySet<string>,
): VariableChange[] {
  const before = new Map(approved.map((v) => [v.id, v]));
  return current
    .filter((v) => used.has(v.id) && before.has(v.id) && !sameNumber(before.get(v.id)!.value, v.value))
    .map((v) => ({ label: v.label, before: before.get(v.id)!.value, after: v.value }));
}

/** Id переменных, которые стоят множителями в строках снимка. */
export function snapshotVariableIds(snapshot: ItemsSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const a of snapshot.articles)
    for (const s of a.subarticles)
      for (const l of s.lines) for (const m of l.multipliers) if (m && "variableId" in m) ids.add(m.variableId);
  return ids;
}

/** Снимок из базы (Json): только наш формат, иначе null. */
export function parseItemsSnapshot(raw: unknown): ItemsSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Partial<ItemsSnapshot>;
  if (s.version !== 1 || !Array.isArray(s.articles) || !Array.isArray(s.variables) || !s.totals) return null;
  return s as ItemsSnapshot;
}

/**
 * Строение снимка без значений переменных и сумм: статьи, подстатьи, строки и всё, что в них
 * ввели (кол-во, ставка, какие множители, налог %, тип, форма оплаты). Одинаковое строение у
 * черновика и версии — значит, глава ничего не менял, разница только в переменных.
 */
export function snapshotStructureKey(snapshot: ItemsSnapshot): string {
  const num = (v: string | null) => (v == null ? null : Number(v));
  return JSON.stringify(
    snapshot.articles.map((a) => [
      // Название статьи — из шаблона (его ведёт продюсер), в строение не входит.
      a.id,
      a.templateArticleId,
      a.subarticles.map((s) => [
        s.id,
        s.name,
        s.lines.map((l) => [
          l.id,
          l.name,
          l.unit,
          l.expenseTypeId !== undefined ? l.expenseTypeId : l.expenseType,
          num(l.quantity),
          num(l.rate),
          l.multipliers.map((m) => (m == null ? null : "variableId" in m ? { v: m.variableId } : { n: Number(m.value) })),
          l.paymentFormId !== undefined ? l.paymentFormId : l.paymentForm,
          num(l.taxPercent),
        ]),
      ]),
    ]),
  );
}
