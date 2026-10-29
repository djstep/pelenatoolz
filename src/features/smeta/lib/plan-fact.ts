/**
 * План/факт по статьям смет. Только расчёт, без базы: на входе последние утверждённые
 * версии, статьи и факт (всё с налогом), на выходе строки и итоги.
 */

export type PlanFactKind =
  /** Статья последней утверждённой версии. */
  | "plan"
  /** Факт по статье, которой нет ни в одной утверждённой версии. */
  | "no_plan"
  /** Статья была в прошлой версии, в последнюю не попала, а факт по ней есть. */
  | "out_of_plan";

export const PLAN_FACT_KIND_LABELS: Record<PlanFactKind, string> = {
  plan: "",
  no_plan: "без плана",
  out_of_plan: "вне плана",
};

export type PlanFactNumbers = {
  plan: number;
  accrued: number;
  paid: number;
  /** План − начислено. Пусто у «Без статьи» — плана там нет. */
  remaining: number | null;
  /** Начислено / план, %. Пусто, если плана нет. */
  percent: number | null;
  /** Начислено или оплачено больше плана. */
  overrun: boolean;
};

export type PlanFactRow = PlanFactNumbers & {
  itemId: string;
  code: string;
  name: string;
  kind: PlanFactKind;
  /** Статья в плане, но из черновика её уже убрали (в архиве). */
  removedFromDraft: boolean;
};

export type PlanFactDepartment = {
  id: string;
  name: string;
  codePrefix: string;
  versionNumber: number | null;
  versionApprovedAt: string | null;
  rows: PlanFactRow[];
  totals: PlanFactNumbers;
};

export type PlanFactReport = {
  departments: PlanFactDepartment[];
  /** «Без статьи»: только тем, кто видит все сметы, и только без фильтра по цеху. */
  unassigned: PlanFactNumbers | null;
  project: PlanFactNumbers;
};

export type PlanFactInput = {
  departments: { id: string; name: string; codePrefix: string }[];
  /** Последняя утверждённая версия цеха. */
  versions: Map<
    string,
    {
      number: number;
      approvedAt: string;
      lines: { itemId: string; code: string; name: string; total: number }[];
    }
  >;
  /** Статьи из строк версий и с фактом. */
  items: Map<
    string,
    { code: string; name: string; departmentId: string; archived: boolean; inAnyVersion: boolean }
  >;
  facts: Map<string, { accrued: number; paid: number }>;
  unassigned: { accrued: number; paid: number } | null;
};

const EPS = 0.005;

/** «весь период», «с 01.10.2026», «01.10.2026 — 31.10.2026». Даты — ГГГГ-ММ-ДД. */
export function planFactPeriodLabel(dateFrom: string | null, dateTo: string | null) {
  const ru = (iso: string) => iso.split("-").reverse().join(".");
  if (dateFrom && dateTo) return `${ru(dateFrom)} — ${ru(dateTo)}`;
  if (dateFrom) return `с ${ru(dateFrom)}`;
  if (dateTo) return `по ${ru(dateTo)}`;
  return "весь период";
}

/**
 * Пометка статьи, которой нет в последней утверждённой версии: была хоть в одной версии —
 * «вне плана», не было ни в одной — «без плана».
 */
export function unplannedKind(inAnyVersion: boolean): Exclude<PlanFactKind, "plan"> {
  return inAnyVersion ? "out_of_plan" : "no_plan";
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function planFactNumbers(plan: number, accrued: number, paid: number): PlanFactNumbers {
  plan = round2(plan);
  accrued = round2(accrued);
  paid = round2(paid);
  return {
    plan,
    accrued,
    paid,
    remaining: round2(plan - accrued),
    percent: plan > EPS ? round2((accrued / plan) * 100) : null,
    overrun: accrued > plan + EPS || paid > plan + EPS,
  };
}

/** «Без статьи»: плана нет — остаток, % исполнения и перерасход не считаются. */
export function unassignedNumbers(accrued: number, paid: number): PlanFactNumbers {
  return { ...planFactNumbers(0, accrued, paid), remaining: null, percent: null, overrun: false };
}

function sumNumbers(list: readonly PlanFactNumbers[]): PlanFactNumbers {
  let plan = 0;
  let accrued = 0;
  let paid = 0;
  for (const n of list) {
    plan += n.plan;
    accrued += n.accrued;
    paid += n.paid;
  }
  return planFactNumbers(plan, accrued, paid);
}

export function buildPlanFact(input: PlanFactInput): PlanFactReport {
  const departments = input.departments.map((d): PlanFactDepartment => {
    const version = input.versions.get(d.id) ?? null;
    const planned = new Set<string>();
    const rows: PlanFactRow[] = [];

    for (const line of version?.lines ?? []) {
      planned.add(line.itemId);
      const fact = input.facts.get(line.itemId);
      rows.push({
        itemId: line.itemId,
        // В плане — код и наименование на момент утверждения.
        code: line.code,
        name: line.name,
        kind: "plan",
        removedFromDraft: input.items.get(line.itemId)?.archived ?? false,
        ...planFactNumbers(line.total, fact?.accrued ?? 0, fact?.paid ?? 0),
      });
    }

    const extra: PlanFactRow[] = [];
    for (const [itemId, fact] of input.facts) {
      if (planned.has(itemId)) continue;
      const item = input.items.get(itemId);
      if (!item || item.departmentId !== d.id) continue;
      if (Math.abs(fact.accrued) < EPS && Math.abs(fact.paid) < EPS) continue;
      extra.push({
        itemId,
        code: item.code,
        name: item.name,
        kind: unplannedKind(item.inAnyVersion),
        removedFromDraft: false,
        ...planFactNumbers(0, fact.accrued, fact.paid),
      });
    }
    extra.sort((a, b) => a.code.localeCompare(b.code, "ru"));
    rows.push(...extra);

    return {
      id: d.id,
      name: d.name,
      codePrefix: d.codePrefix,
      versionNumber: version?.number ?? null,
      versionApprovedAt: version?.approvedAt ?? null,
      rows,
      totals: sumNumbers(rows),
    };
  });

  const unassigned = input.unassigned
    ? unassignedNumbers(input.unassigned.accrued, input.unassigned.paid)
    : null;
  const project = sumNumbers([
    ...departments.map((d) => d.totals),
    ...(unassigned ? [unassigned] : []),
  ]);
  return { departments, unassigned, project };
}
