/**
 * «Обновить из КПП» для строк работы отчёта смены — чистые части (без базы), их вызывает
 * `sync-work-rows.ts`. Строка отчёта узнаётся по `sourceKey`; у спецтранспорта это
 * `transport:<id строки спецтранспорта>`, поэтому пока строка спецтранспорта сохраняется
 * по id, строка отчёта та же: км, оплата и начисления не теряются.
 */

export type SeedCandidate = {
  sourceKey: string;
  kind: "ACTOR" | "RESOURCE" | "TRANSPORT" | "LOCATION";
  displayName: string;
  categoryLabel: string | null;
  actorId?: string | null;
  resourceItemId?: string | null;
  locationId?: string | null;
  factStart?: string | null;
  factEnd?: string | null;
  shiftHoursMin?: number | null;
  unpaidOvertimeMin?: number | null;
  shiftRate?: number | null;
  taxPercent?: number | null;
  overtimeMode?: "HALF_HOUR" | "HOURLY_CUMULATIVE" | "HOURLY_FLAT" | null;
  unpaidOvertimeMode?: "FIRST_HOUR" | "EACH_HOUR" | null;
  tracksMileage?: boolean;
  kmRate?: number | null;
  /** Статья строки спецтранспорта — пишется в строку отчёта только при её создании */
  budgetItemId?: string | null;
  sortOrder: number;
};

/** Строка спецтранспорта дня → кандидат строки отчёта. Конец работы — в факт конца. */
export function transportCandidate(
  t: {
    id: string;
    name: string;
    callTime: string | null;
    wrapTime: string | null;
    kmRate: number | null;
    budgetItemId: string | null;
  },
  sortOrder: number,
): SeedCandidate {
  return {
    sourceKey: `transport:${t.id}`,
    kind: "TRANSPORT",
    displayName: t.name,
    categoryLabel: "Спецтранспорт",
    factStart: t.callTime,
    factEnd: t.wrapTime,
    shiftHoursMin: null,
    unpaidOvertimeMin: null,
    shiftRate: null,
    taxPercent: null,
    tracksMileage: true,
    kmRate: t.kmRate,
    budgetItemId: t.budgetItemId,
    sortOrder,
  };
}

/** Новые кандидаты, пары «строка отчёта — кандидат» и строки, которых больше нет в КПП. */
export function splitWorkRows<R extends { sourceKey: string }>(
  candidates: readonly SeedCandidate[],
  existing: readonly R[],
): { added: SeedCandidate[]; kept: { prev: R; c: SeedCandidate }[]; removed: R[] } {
  const existingByKey = new Map(existing.map((r) => [r.sourceKey, r]));
  const keepKeys = new Set(candidates.map((c) => c.sourceKey));
  const added: SeedCandidate[] = [];
  const kept: { prev: R; c: SeedCandidate }[] = [];
  for (const c of candidates) {
    const prev = existingByKey.get(c.sourceKey);
    if (prev) kept.push({ prev, c });
    else added.push(c);
  }
  return { added, kept, removed: existing.filter((r) => !keepKeys.has(r.sourceKey)) };
}

/** Пустое время строки берётся из вызывного; заполненное не трогается. */
export function timesAfterRefresh(
  prev: { factStart: string | null; factEnd: string | null },
  c: SeedCandidate,
) {
  return {
    factStart: prev.factStart?.trim() ? prev.factStart : c.factStart || null,
    factEnd: prev.factEnd?.trim() ? prev.factEnd : c.factEnd || null,
  };
}

/**
 * Что «Обновить из КПП» пишет в существующую строку помимо ставок (ставки — только с
 * галочкой) и оплаты. Статья строки (`budgetItemId`), факт км, Т/О и доплаты не меняются.
 */
export function refreshedRowFields(
  prev: { factStart: string | null; factEnd: string | null },
  c: SeedCandidate,
) {
  return {
    displayName: c.displayName,
    categoryLabel: c.categoryLabel,
    actorId: c.actorId ?? null,
    resourceItemId: c.resourceItemId ?? null,
    locationId: c.locationId ?? null,
    ...timesAfterRefresh(prev, c),
    sortOrder: c.sortOrder,
  };
}

/** Поля новой строки помимо ставок и оплаты. Статья — снимок со строки спецтранспорта. */
export function newRowFields(reportId: string, c: SeedCandidate) {
  return {
    reportId,
    kind: c.kind,
    sourceKey: c.sourceKey,
    displayName: c.displayName,
    categoryLabel: c.categoryLabel,
    actorId: c.actorId ?? null,
    resourceItemId: c.resourceItemId ?? null,
    locationId: c.locationId ?? null,
    factStart: c.factStart || null,
    factEnd: c.factEnd || null,
    lunchSkipped: false,
    budgetItemId: c.kind === "TRANSPORT" ? (c.budgetItemId ?? null) : null,
    sortOrder: c.sortOrder,
  };
}
