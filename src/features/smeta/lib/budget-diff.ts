/**
 * Сравнение «последняя утверждённая версия ↔ черновик» по id статьи.
 * Код — личность статьи: смена кода в строке даёт новую статью, поэтому в сравнении это
 * «удалено» + «добавлено» (с подсказкой, если совпадает наименование или строка листа).
 */

export type DiffValues = {
  code: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
  days: number | null;
  amount: number;
  taxPercent: number | null;
  tax: number;
  total: number;
  sortOrder: number;
};

export type DiffSource = DiffValues & { itemId: string };

export type DiffField = Exclude<keyof DiffValues, "code" | "sortOrder">;

export const DIFF_FIELD_LABELS: Record<DiffField, string> = {
  name: "Наименование",
  unit: "Ед.",
  quantity: "Кол-во",
  rate: "Ставка",
  days: "Дни/смены",
  amount: "Сумма",
  taxPercent: "Налог, %",
  tax: "Налог",
  total: "Итого",
};

const FIELDS = Object.keys(DIFF_FIELD_LABELS) as DiffField[];

export type DiffRow = {
  itemId: string;
  kind: "added" | "removed" | "changed" | "same";
  code: string;
  before: DiffValues | null;
  after: DiffValues | null;
  /** Какие поля изменились (для «changed»). */
  fields: DiffField[];
  /** «удалено» + «добавлено» похожи на смену кода: код парной строки. */
  codeChangePair: string | null;
};

export type BudgetDiff = {
  rows: DiffRow[];
  totalBefore: number;
  totalAfter: number;
  counts: { added: number; removed: number; changed: number; same: number };
  /** Нет ни добавленных, ни удалённых, ни изменённых статей. */
  empty: boolean;
};

function sameValue(a: string | number | null, b: string | number | null) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.00005;
  return (a ?? null) === (b ?? null);
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** before — строки последней версии (или пусто), after — активные статьи черновика. */
export function diffBudget(before: DiffSource[], after: DiffSource[]): BudgetDiff {
  const afterById = new Map(after.map((a) => [a.itemId, a]));
  const beforeIds = new Set(before.map((b) => b.itemId));
  const rows: (DiffRow & { order: number })[] = [];

  for (const b of before) {
    const a = afterById.get(b.itemId);
    if (!a) {
      rows.push({
        itemId: b.itemId,
        kind: "removed",
        code: b.code,
        before: b,
        after: null,
        fields: [],
        codeChangePair: null,
        order: b.sortOrder,
      });
      continue;
    }
    const fields = FIELDS.filter((f) => !sameValue(b[f], a[f]));
    rows.push({
      itemId: a.itemId,
      kind: fields.length > 0 ? "changed" : "same",
      code: a.code,
      before: b,
      after: a,
      fields,
      codeChangePair: null,
      order: a.sortOrder,
    });
  }
  for (const a of after) {
    if (beforeIds.has(a.itemId)) continue;
    rows.push({
      itemId: a.itemId,
      kind: "added",
      code: a.code,
      before: null,
      after: a,
      fields: [],
      codeChangePair: null,
      order: a.sortOrder,
    });
  }

  // Подсказка «похоже на смену кода»: удалённая и добавленная с тем же наименованием
  // или на той же строке листа. Пары один к одному.
  const added = rows.filter((r) => r.kind === "added");
  const used = new Set<string>();
  for (const removed of rows.filter((r) => r.kind === "removed")) {
    const pair =
      added.find(
        (a) =>
          !used.has(a.itemId) &&
          removed.before!.name.trim() !== "" &&
          a.after!.name.trim().toLowerCase() === removed.before!.name.trim().toLowerCase(),
      ) ??
      added.find((a) => !used.has(a.itemId) && a.after!.sortOrder === removed.before!.sortOrder);
    if (!pair) continue;
    used.add(pair.itemId);
    removed.codeChangePair = pair.code;
    pair.codeChangePair = removed.code;
  }

  rows.sort((x, y) => x.order - y.order || (x.kind === "removed" ? -1 : 1));
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const r of rows) counts[r.kind] += 1;

  return {
    rows: rows.map((r) => {
      const { order, ...row } = r;
      void order;
      return row;
    }),
    totalBefore: round2(before.reduce((s, b) => s + b.total, 0)),
    totalAfter: round2(after.reduce((s, a) => s + a.total, 0)),
    counts,
    empty: counts.added + counts.removed + counts.changed === 0,
  };
}
