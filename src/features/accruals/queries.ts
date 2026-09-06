import { AccrualType, Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";

export type AccrualFilters = {
  q?: string;
  dateFrom?: string;
  dateTo?: string;
  budgetLineId?: string;
  counterpartyId?: string;
  groupUnit?: string;
};

export async function listAccruals(projectId: string, filters: AccrualFilters = {}) {
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
  if (filters.budgetLineId) where.budgetLineId = filters.budgetLineId;
  if (filters.counterpartyId) where.counterpartyId = filters.counterpartyId;
  if (filters.groupUnit) where.groupUnit = filters.groupUnit;

  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { comment: { contains: q, mode: "insensitive" } },
      { budgetLine: { title: { contains: q, mode: "insensitive" } } },
      { counterparty: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.accrual.findMany({
    where,
    include: {
      budgetLine: { select: { id: true, title: true, lineType: true } },
      counterparty: { select: { id: true, name: true } },
      shootDay: { select: { id: true, date: true, dayNumber: true, unit: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });

  return serializeForClient(rows) as typeof rows;
}

export async function getAccrualTotals(
  projectId: string,
  filters: AccrualFilters = {},
) {
  const rows = await listAccruals(projectId, filters);
  let amount = 0;
  let withTax = 0;
  for (const r of rows) {
    amount += Number(r.amount);
    withTax += Number(r.amountWithTax);
  }
  return { count: rows.length, amount, withTax };
}

export async function listBudgetLinesForAccrual(projectId: string) {
  const rows = await prisma.budgetLine.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      lineType: true,
      unitCost: true,
      unitsCount: true,
      taxPercent: true,
      plannedCounterpartyId: true,
      linkedResourceType: true,
      linkedResourceId: true,
    },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { title: "asc" }],
  });
  return serializeForClient(rows) as typeof rows;
}

/** Lines relevant for shift entry: linked resource or PER_SHIFT. */
export async function listShiftEntryBudgetLines(projectId: string) {
  const rows = await prisma.budgetLine.findMany({
    where: {
      projectId,
      OR: [
        { linkedResourceId: { not: null } },
        { lineType: "PER_SHIFT" },
      ],
    },
    select: {
      id: true,
      title: true,
      lineType: true,
      unitCost: true,
      unitsCount: true,
      taxPercent: true,
      plannedCounterpartyId: true,
      linkedResourceType: true,
      linkedResourceId: true,
      plannedCounterparty: { select: { id: true, name: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
  return serializeForClient(rows) as typeof rows;
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

export async function listActorsBriefForLink(projectId: string) {
  const rows = await prisma.actor.findMany({
    where: { projectId },
    select: { id: true, lastName: true, firstName: true, middleName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return rows;
}

export async function listResourceItemsBriefForLink(projectId: string) {
  const rows = await prisma.resourceItem.findMany({
    where: { category: { projectId } },
    select: {
      id: true,
      name: true,
      category: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    categoryName: r.category.name,
  }));
}

export type AccrualListRow = Awaited<ReturnType<typeof listAccruals>>[number];
export type AccrualTypeValue = AccrualType;
