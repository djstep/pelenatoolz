import { prisma } from "@/shared/db/prisma";

function actorDisplayName(a: {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
}) {
  return [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" ");
}

/**
 * Resolve counterparty + tax defaults when picking a budget line.
 * Prefer factual (recent accrual / name match from production), else planned.
 */
export async function suggestDefaultsForBudgetLine(
  projectId: string,
  budgetLineId: string,
  shootDayId?: string | null,
): Promise<{
  counterpartyId: string | null;
  taxPercent: number | null;
  amount: number | null;
  quantity: number | null;
  source: "factual" | "planned" | "linked" | null;
}> {
  const line = await prisma.budgetLine.findFirst({
    where: { id: budgetLineId, projectId },
    select: {
      unitCost: true,
      unitsCount: true,
      taxPercent: true,
      plannedCounterpartyId: true,
      linkedResourceType: true,
      linkedResourceId: true,
    },
  });
  if (!line) {
    return {
      counterpartyId: null,
      taxPercent: null,
      amount: null,
      quantity: null,
      source: null,
    };
  }

  // 1) Latest accrual on this line (factual)
  const lastAccrual = await prisma.accrual.findFirst({
    where: { projectId, budgetLineId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: { counterpartyId: true, taxPercent: true, amount: true, quantity: true },
  });
  if (lastAccrual) {
    return {
      counterpartyId: lastAccrual.counterpartyId,
      taxPercent:
        lastAccrual.taxPercent != null
          ? Number(lastAccrual.taxPercent)
          : line.taxPercent != null
            ? Number(line.taxPercent)
            : null,
      amount: Number(line.unitCost) * Number(line.unitsCount),
      quantity: lastAccrual.quantity != null ? Number(lastAccrual.quantity) : 1,
      source: "factual",
    };
  }

  // 2) Linked actor/resource → match counterparty by name; tax from actor/work row
  let linkedTax: number | null = null;
  let linkedCp: string | null = null;
  if (line.linkedResourceType === "ACTOR" && line.linkedResourceId) {
    const actor = await prisma.actor.findFirst({
      where: { id: line.linkedResourceId, projectId },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        middleName: true,
        taxPercent: true,
        shiftRate: true,
      },
    });
    if (actor) {
      linkedTax =
        actor.taxPercent != null
          ? Number(actor.taxPercent)
          : line.taxPercent != null
            ? Number(line.taxPercent)
            : null;
      const name = actorDisplayName(actor);
      const cp = await prisma.counterparty.findFirst({
        where: {
          projectId,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      });
      linkedCp = cp?.id ?? null;

      if (shootDayId) {
        const work = await prisma.productionReportWorkRow.findFirst({
          where: {
            actorId: actor.id,
            report: { shootDayId },
          },
          select: { taxPercent: true, shiftRate: true, totalPay: true },
        });
        if (work?.taxPercent != null) linkedTax = Number(work.taxPercent);
      }
    }
  } else if (
    line.linkedResourceType === "RESOURCE_ITEM" &&
    line.linkedResourceId
  ) {
    const item = await prisma.resourceItem.findFirst({
      where: { id: line.linkedResourceId, category: { projectId } },
      select: { name: true, shiftRate: true },
    });
    if (item) {
      const cp = await prisma.counterparty.findFirst({
        where: {
          projectId,
          name: { equals: item.name, mode: "insensitive" },
        },
        select: { id: true },
      });
      linkedCp = cp?.id ?? null;
    }
  }

  if (linkedCp) {
    return {
      counterpartyId: linkedCp,
      taxPercent:
        linkedTax ??
        (line.taxPercent != null ? Number(line.taxPercent) : null),
      amount: Number(line.unitCost) * Number(line.unitsCount),
      quantity: 1,
      source: "linked",
    };
  }

  // 3) Planned
  return {
    counterpartyId: line.plannedCounterpartyId,
    taxPercent: line.taxPercent != null ? Number(line.taxPercent) : linkedTax,
    amount: Number(line.unitCost) * Number(line.unitsCount),
    quantity: 1,
    source: line.plannedCounterpartyId ? "planned" : null,
  };
}

/**
 * If counterparty is planned/factual for exactly one budget line — return that line.
 */
export async function suggestBudgetLineForCounterparty(
  projectId: string,
  counterpartyId: string,
): Promise<string | null> {
  const planned = await prisma.budgetLine.findMany({
    where: { projectId, plannedCounterpartyId: counterpartyId },
    select: { id: true },
  });
  const accrualLines = await prisma.accrual.findMany({
    where: { projectId, counterpartyId },
    select: { budgetLineId: true },
    distinct: ["budgetLineId"],
  });
  const ids = new Set([
    ...planned.map((p) => p.id),
    ...accrualLines.map((a) => a.budgetLineId),
  ]);
  if (ids.size === 1) return [...ids][0]!;
  return null;
}
