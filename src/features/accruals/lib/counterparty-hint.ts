import { prisma } from "@/shared/db/prisma";

/** Чьё начисление: актёр, позиция ресурса или объект (как у строки отчёта смены). */
export type AccrualEntityRef = {
  actorId?: string | null;
  resourceItemId?: string | null;
  locationId?: string | null;
  /** Имя для совпадения с контрагентом (ФИО актёра, название ресурса или объекта). */
  names: string[];
};

export type CounterpartyHints = {
  /** Начисления из отчётов с контрагентом, новые сверху. */
  history: {
    counterpartyId: string;
    actorId: string | null;
    resourceItemId: string | null;
    locationId: string | null;
  }[];
  counterparties: { id: string; name: string }[];
};

export function actorDisplayName(a: {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
}) {
  return [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" ");
}

/** Варианты имени актёра для совпадения с контрагентом: ФИО и «Фамилия Имя». */
export function actorNames(a: {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
}) {
  return [actorDisplayName(a), [a.lastName, a.firstName].filter(Boolean).join(" ")];
}

function normalizeName(s: string) {
  return s.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

export async function loadCounterpartyHints(projectId: string): Promise<CounterpartyHints> {
  const [rows, counterparties] = await Promise.all([
    prisma.accrual.findMany({
      where: { projectId, counterpartyId: { not: null }, workRowId: { not: null } },
      select: {
        counterpartyId: true,
        workRow: { select: { actorId: true, resourceItemId: true, locationId: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 1000,
    }),
    prisma.counterparty.findMany({
      where: { projectId },
      select: { id: true, name: true },
    }),
  ]);
  return {
    history: rows.flatMap((r) =>
      r.counterpartyId && r.workRow ? [{ counterpartyId: r.counterpartyId, ...r.workRow }] : [],
    ),
    counterparties,
  };
}

/**
 * Подсказка контрагента: последний контрагент в начислениях этого актёра/ресурса/объекта,
 * иначе контрагент с тем же именем. Нет — null («контрагент не указан»).
 */
export function pickCounterparty(entity: AccrualEntityRef, hints: CounterpartyHints): string | null {
  const fromHistory = hints.history.find(
    (h) =>
      (entity.actorId && h.actorId === entity.actorId) ||
      (entity.resourceItemId && h.resourceItemId === entity.resourceItemId) ||
      (entity.locationId && h.locationId === entity.locationId),
  );
  if (fromHistory) return fromHistory.counterpartyId;

  const wanted = new Set(entity.names.filter(Boolean).map(normalizeName));
  const byName = hints.counterparties.find((c) => wanted.has(normalizeName(c.name)));
  return byName?.id ?? null;
}
