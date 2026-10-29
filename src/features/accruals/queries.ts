import { AccrualReportPart, AccrualType, Prisma } from "@prisma/client";
import {
  actorDisplayName,
  actorNames,
  loadCounterpartyHints,
  pickCounterparty,
} from "@/features/accruals/lib/counterparty-hint";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export type AccrualFilters = {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  /** id статьи или "none" — без статьи */
  budgetItemId?: string;
  counterpartyId?: string;
  groupUnit?: string;
};

/** Цеха, чьи статьи пользователь видит: "all" или список id (для поиска по статье). */
export type VisibleDepartments = "all" | readonly string[];

export async function listAccruals(
  projectId: string,
  visible: VisibleDepartments,
  filters: AccrualFilters = {},
) {
  const where: Prisma.AccrualWhereInput = { projectId };

  if (filters.dateFrom || filters.dateTo) {
    where.date = {};
    if (filters.dateFrom) {
      where.date.gte = new Date(`${filters.dateFrom}T00:00:00.000Z`);
    }
    if (filters.dateTo) {
      where.date.lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
    }
  }
  if (filters.budgetItemId === "none") where.budgetItemId = null;
  else if (filters.budgetItemId) where.budgetItemId = filters.budgetItemId;
  if (filters.counterpartyId) where.counterpartyId = filters.counterpartyId;
  if (filters.groupUnit) where.groupUnit = filters.groupUnit;

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    // По коду и наименованию ищем только среди статей смет, которые пользователь видит.
    const itemMatch: Prisma.BudgetItemWhereInput = {
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
      ...(visible === "all" ? {} : { departmentId: { in: [...visible] } }),
    };
    where.OR = [
      { comment: { contains: q, mode: "insensitive" } },
      { budgetItem: itemMatch },
      { counterparty: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.accrual.findMany({
    where,
    include: {
      counterparty: { select: { id: true, name: true } },
      shootDay: { select: { id: true, date: true, dayNumber: true, unit: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return serializeForClient(rows) as typeof rows;
}

export function accrualTotals(rows: { amount: unknown; amountWithTax: unknown }[]) {
  let amount = 0;
  let withTax = 0;
  for (const r of rows) {
    amount += Number(r.amount);
    withTax += Number(r.amountWithTax);
  }
  return { count: rows.length, amount, withTax };
}

export async function listShootDaysBrief(projectId: string) {
  const rows = await prisma.shootDay.findMany({
    where: { projectId },
    select: {
      id: true,
      date: true,
      dayNumber: true,
      unit: true,
      dayType: true,
    },
    orderBy: [{ date: "asc" }, { dayNumber: "asc" }],
  });
  return serializeForClient(rows) as typeof rows;
}

export async function listProjectGroupUnits(projectId: string): Promise<string[]> {
  const [fromDays, fromAccruals] = await Promise.all([
    prisma.shootDay.findMany({
      where: { projectId, unit: { not: null } },
      select: { unit: true },
      distinct: ["unit"],
    }),
    prisma.accrual.findMany({
      where: { projectId, groupUnit: { not: null } },
      select: { groupUnit: true },
      distinct: ["groupUnit"],
    }),
  ]);
  const set = new Set<string>();
  for (const d of fromDays) if (d.unit) set.add(d.unit);
  for (const a of fromAccruals) if (a.groupUnit) set.add(a.groupUnit);
  if (set.size === 0) set.add("main");
  return [...set].sort();
}

export type ShiftEntryRow = {
  key: string;
  kind: "actor" | "resource" | "location";
  name: string;
  /** Категория ресурса */
  hint: string | null;
  budgetItemId: string;
  counterpartyId: string | null;
  /** Ставка смены без налога */
  amount: number;
  taxPercent: number | null;
  /** Есть в отчёте выбранного дня */
  onDay: boolean;
  /** Смена уже начислена из отчёта этого дня */
  accruedFromReport: boolean;
};

/**
 * «Ввод по сменам»: актёры, позиции ресурсов и объекты, у которых статья по умолчанию —
 * из смет, которые пользователь видит. Сумма — ставка смены, контрагент — подсказка.
 */
export async function listShiftEntryRows(
  projectId: string,
  shootDayId: string | null,
  visibleItemIds: ReadonlySet<string>,
): Promise<ShiftEntryRow[]> {
  const ids = [...visibleItemIds];
  if (ids.length === 0) return [];

  const [actors, items, locations, dayRows, hints] = await Promise.all([
    prisma.actor.findMany({
      where: { projectId, defaultBudgetItemId: { in: ids } },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        middleName: true,
        defaultBudgetItemId: true,
        shiftRate: true,
        taxPercent: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.resourceItem.findMany({
      where: { category: { projectId }, defaultBudgetItemId: { in: ids } },
      select: {
        id: true,
        name: true,
        defaultBudgetItemId: true,
        shiftRate: true,
        taxPercent: true,
        category: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.location.findMany({
      where: { projectId, defaultBudgetItemId: { in: ids } },
      select: {
        id: true,
        name: true,
        defaultBudgetItemId: true,
        shiftRate: true,
        taxPercent: true,
      },
      orderBy: [{ name: "asc" }],
    }),
    shootDayId
      ? prisma.productionReportWorkRow.findMany({
          where: { report: { shootDayId, shootDay: { projectId } } },
          select: {
            actorId: true,
            resourceItemId: true,
            locationId: true,
            accruals: {
              where: {
                reportPart: AccrualReportPart.SHIFT,
                amountWithTax: { not: 0 },
              },
              select: { id: true },
            },
          },
        })
      : Promise.resolve([]),
    loadCounterpartyHints(projectId),
  ]);

  const onDay = new Set<string>();
  const accrued = new Set<string>();
  for (const r of dayRows) {
    const keys = [
      r.actorId ? `actor:${r.actorId}` : null,
      r.resourceItemId ? `resource:${r.resourceItemId}` : null,
      r.locationId ? `location:${r.locationId}` : null,
    ].filter((k): k is string => !!k);
    for (const k of keys) {
      onDay.add(k);
      if (r.accruals.length > 0) accrued.add(k);
    }
  }

  const num = (v: Prisma.Decimal | null) => (v != null ? Number(v) : null);
  const rows: ShiftEntryRow[] = [];
  for (const a of actors) {
    const key = `actor:${a.id}`;
    rows.push({
      key,
      kind: "actor",
      name: actorDisplayName(a),
      hint: null,
      budgetItemId: a.defaultBudgetItemId!,
      counterpartyId: pickCounterparty({ actorId: a.id, names: actorNames(a) }, hints),
      amount: num(a.shiftRate) ?? 0,
      taxPercent: num(a.taxPercent),
      onDay: onDay.has(key),
      accruedFromReport: accrued.has(key),
    });
  }
  for (const i of items) {
    const key = `resource:${i.id}`;
    rows.push({
      key,
      kind: "resource",
      name: i.name,
      hint: i.category.name,
      budgetItemId: i.defaultBudgetItemId!,
      counterpartyId: pickCounterparty({ resourceItemId: i.id, names: [i.name] }, hints),
      amount: num(i.shiftRate) ?? 0,
      taxPercent: num(i.taxPercent),
      onDay: onDay.has(key),
      accruedFromReport: accrued.has(key),
    });
  }
  for (const l of locations) {
    const key = `location:${l.id}`;
    rows.push({
      key,
      kind: "location",
      name: l.name,
      hint: null,
      budgetItemId: l.defaultBudgetItemId!,
      counterpartyId: pickCounterparty({ locationId: l.id, names: [l.name] }, hints),
      amount: num(l.shiftRate) ?? 0,
      taxPercent: num(l.taxPercent),
      onDay: onDay.has(key),
      accruedFromReport: accrued.has(key),
    });
  }
  // Сначала те, кто был в этот день.
  return rows.sort((a, b) => Number(b.onDay) - Number(a.onDay));
}

export type AccrualListRow = Awaited<ReturnType<typeof listAccruals>>[number];
export type AccrualTypeValue = AccrualType;
