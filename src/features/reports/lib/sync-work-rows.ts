import type { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import { computeWorkPay } from "@/features/reports/lib/compute-work-pay";
import { dec } from "@/shared/db/serialize-decimal";

type SeedCandidate = {
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
  forceMajeurePct?: number | null;
  sortOrder: number;
};

function actorName(a: {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
}) {
  return [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" ");
}

/** Сидирует строки факта работы из актёров/ресурсов/транспорта/локаций дня. */
export async function syncProductionWorkRows(
  projectId: string,
  shootDayId: string,
  reportId: string,
) {
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: {
      scenes: {
        include: {
          scene: {
            select: {
              characters: {
                select: { characterId: true, character: { select: { name: true } } },
              },
              locations: {
                select: {
                  locationId: true,
                  location: { select: { id: true, name: true, sublocation: true } },
                },
              },
              resourceItems: {
                select: {
                  itemId: true,
                  item: {
                    select: {
                      id: true,
                      name: true,
                      shiftRate: true,
                      shiftHoursMin: true,
                      unpaidOvertimeMin: true,
                      category: { select: { name: true, perShift: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      actorCalls: true,
      resourceUsages: {
        where: { isUsed: true },
        include: {
          item: {
            include: { category: { select: { name: true, perShift: true } } },
          },
        },
      },
      resourceCalls: true,
      transports: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!day) return;

  const characterIds = new Set<string>();
  for (const row of day.scenes) {
    for (const link of row.scene.characters) characterIds.add(link.characterId);
  }

  const actors = await prisma.actor.findMany({
    where: { projectId, characterId: { in: [...characterIds] } },
    include: {
      overtimeRates: true,
      character: { select: { name: true } },
    },
  });

  const candidates: SeedCandidate[] = [];
  let order = 0;

  for (const actor of actors) {
    const call = day.actorCalls.find((c) => c.actorId === actor.id);
    candidates.push({
      sourceKey: `actor:${actor.id}`,
      kind: "ACTOR",
      displayName: actor.character
        ? `${actorName(actor)} · ${actor.character.name}`
        : actorName(actor),
      categoryLabel: "Актёр",
      actorId: actor.id,
      factStart: call?.arrivalTime ?? call?.readyTime ?? actor.arrivalTime,
      factEnd: call?.wrapTime ?? null,
      shiftHoursMin: actor.shiftHoursMin,
      unpaidOvertimeMin: actor.unpaidOvertimeMin,
      shiftRate: dec(actor.shiftRate),
      forceMajeurePct: dec(actor.forceMajeurePct),
      sortOrder: order++,
    });
  }

  const seenResources = new Set<string>();
  for (const usage of day.resourceUsages) {
    const key = `resource:${usage.itemId}`;
    if (seenResources.has(key)) continue;
    seenResources.add(key);
    candidates.push({
      sourceKey: key,
      kind: "RESOURCE",
      displayName: usage.item.name,
      categoryLabel: usage.item.category.name,
      resourceItemId: usage.itemId,
      factStart: usage.arrivalTime ?? usage.readyTime,
      factEnd: usage.wrapTime,
      shiftHoursMin: usage.item.shiftHoursMin,
      unpaidOvertimeMin: usage.item.unpaidOvertimeMin,
      shiftRate: dec(usage.item.shiftRate),
      forceMajeurePct: null,
      sortOrder: order++,
    });
  }

  for (const row of day.scenes) {
    for (const link of row.scene.resourceItems) {
      if (link.item.category.perShift) continue;
      const key = `resource:${link.itemId}`;
      if (seenResources.has(key)) continue;
      seenResources.add(key);
      const call = day.resourceCalls.find(
        (c) =>
          c.category === link.item.category.name &&
          (c.name === link.item.name || c.name.startsWith(link.item.name)),
      );
      candidates.push({
        sourceKey: key,
        kind: "RESOURCE",
        displayName: link.item.name,
        categoryLabel: link.item.category.name,
        resourceItemId: link.itemId,
        factStart: call?.arrivalTime ?? call?.readyTime,
        factEnd: call?.wrapTime,
        shiftHoursMin: link.item.shiftHoursMin,
        unpaidOvertimeMin: link.item.unpaidOvertimeMin,
        shiftRate: dec(link.item.shiftRate),
        forceMajeurePct: null,
        sortOrder: order++,
      });
    }
  }

  for (const t of day.transports) {
    candidates.push({
      sourceKey: `transport:${t.id}`,
      kind: "TRANSPORT",
      displayName: t.name,
      categoryLabel: "Спецтранспорт",
      factStart: t.callTime,
      factEnd: null,
      shiftHoursMin: null,
      unpaidOvertimeMin: null,
      shiftRate: null,
      forceMajeurePct: null,
      sortOrder: order++,
    });
  }

  const seenLocations = new Set<string>();
  for (const row of day.scenes) {
    for (const link of row.scene.locations) {
      if (seenLocations.has(link.locationId)) continue;
      seenLocations.add(link.locationId);
      const label = link.location.sublocation
        ? `${link.location.name}.${link.location.sublocation}`
        : link.location.name;
      candidates.push({
        sourceKey: `location:${link.locationId}`,
        kind: "LOCATION",
        displayName: label,
        categoryLabel: "Локация",
        locationId: link.locationId,
        factStart: null,
        factEnd: null,
        sortOrder: order++,
      });
    }
  }

  const existing = await prisma.productionReportWorkRow.findMany({
    where: { reportId },
    select: { id: true, sourceKey: true, lunchSkipped: true, factStart: true, factEnd: true },
  });
  const existingByKey = new Map(existing.map((r) => [r.sourceKey, r]));
  const desiredKeys = new Set(candidates.map((c) => c.sourceKey));

  // Remove rows that are no longer on the day and were never manually timed? Keep all seeded; only delete missing sources without extras
  const stale = existing.filter((r) => !desiredKeys.has(r.sourceKey));
  if (stale.length > 0) {
    await prisma.productionReportWorkRow.deleteMany({
      where: {
        id: { in: stale.map((r) => r.id) },
        extras: { none: {} },
        // keep if user filled times or T/O
        AND: [
          { lunchSkipped: false },
          { OR: [{ factStart: null }, { factStart: "" }] },
          { OR: [{ factEnd: null }, { factEnd: "" }] },
        ],
      },
    });
  }

  for (const c of candidates) {
    const prev = existingByKey.get(c.sourceKey);
    const factStart = prev?.factStart || c.factStart || null;
    const factEnd = prev?.factEnd || c.factEnd || null;
    const lunchSkipped = prev?.lunchSkipped ?? false;

    let overtimeRates: {
      hourNumber: number;
      percentRate: number | null;
      amount: number | null;
      forceMajeurePct: number | null;
    }[] = [];
    if (c.actorId) {
      const actor = actors.find((a) => a.id === c.actorId);
      overtimeRates =
        actor?.overtimeRates.map((r) => ({
          hourNumber: r.hourNumber,
          percentRate: dec(r.percentRate),
          amount: dec(r.amount),
          forceMajeurePct: dec(r.forceMajeurePct),
        })) ?? [];
    }

    const pay = computeWorkPay({
      factStart,
      factEnd,
      lunchSkipped,
      shiftHoursMin: c.shiftHoursMin,
      unpaidOvertimeMin: c.unpaidOvertimeMin,
      shiftRate: c.shiftRate,
      forceMajeurePct: c.forceMajeurePct,
      overtimeRates,
      extrasTotal: 0,
    });

    const data: Prisma.ProductionReportWorkRowUncheckedCreateInput = {
      reportId,
      kind: c.kind,
      sourceKey: c.sourceKey,
      displayName: c.displayName,
      categoryLabel: c.categoryLabel,
      actorId: c.actorId ?? null,
      resourceItemId: c.resourceItemId ?? null,
      locationId: c.locationId ?? null,
      factStart,
      factEnd,
      lunchSkipped,
      workedMin: pay.workedMin,
      factOvertimeMin: pay.factOvertimeMin,
      payableOvertimeMin: pay.payableOvertimeMin,
      shiftHoursMin: c.shiftHoursMin ?? null,
      unpaidOvertimeMin: c.unpaidOvertimeMin ?? null,
      shiftRate: c.shiftRate ?? null,
      forceMajeurePct: c.forceMajeurePct ?? null,
      shiftPay: pay.shiftPay,
      overtimePay: pay.overtimePay,
      extrasPay: pay.extrasPay,
      totalPay: pay.totalPay,
      sortOrder: c.sortOrder,
    };

    if (prev) {
      // Backfill empty times from call sheet; never overwrite user-entered values
      const nextStart = prev.factStart?.trim() ? prev.factStart : c.factStart || null;
      const nextEnd = prev.factEnd?.trim() ? prev.factEnd : c.factEnd || null;
      await prisma.productionReportWorkRow.update({
        where: { id: prev.id },
        data: {
          displayName: c.displayName,
          categoryLabel: c.categoryLabel,
          actorId: c.actorId ?? null,
          resourceItemId: c.resourceItemId ?? null,
          locationId: c.locationId ?? null,
          factStart: nextStart,
          factEnd: nextEnd,
          shiftHoursMin: c.shiftHoursMin ?? null,
          unpaidOvertimeMin: c.unpaidOvertimeMin ?? null,
          shiftRate: c.shiftRate ?? null,
          forceMajeurePct: c.forceMajeurePct ?? null,
          sortOrder: c.sortOrder,
        },
      });
    } else {
      await prisma.productionReportWorkRow.create({ data });
    }
  }

  // Recalc extras + payments for all rows
  const { syncPaymentFromWorkRow } = await import(
    "@/features/reports/lib/sync-payment"
  );
  const rows = await prisma.productionReportWorkRow.findMany({
    where: { reportId },
    include: {
      extras: true,
      actor: { include: { overtimeRates: true } },
    },
  });

  for (const row of rows) {
    const extrasTotal = row.extras.reduce((s, e) => s + Number(e.amount), 0);
    const rates =
      row.actor?.overtimeRates.map((r) => ({
        hourNumber: r.hourNumber,
        percentRate: dec(r.percentRate),
        amount: dec(r.amount),
        forceMajeurePct: dec(r.forceMajeurePct),
      })) ?? [];
    const pay = computeWorkPay({
      factStart: row.factStart,
      factEnd: row.factEnd,
      lunchSkipped: row.lunchSkipped,
      shiftHoursMin: row.shiftHoursMin,
      unpaidOvertimeMin: row.unpaidOvertimeMin,
      shiftRate: dec(row.shiftRate),
      forceMajeurePct: dec(row.forceMajeurePct),
      overtimeRates: rates,
      extrasTotal,
    });
    await prisma.productionReportWorkRow.update({
      where: { id: row.id },
      data: {
        workedMin: pay.workedMin,
        factOvertimeMin: pay.factOvertimeMin,
        payableOvertimeMin: pay.payableOvertimeMin,
        shiftPay: pay.shiftPay,
        overtimePay: pay.overtimePay,
        extrasPay: pay.extrasPay,
        totalPay: pay.totalPay,
      },
    });
    await syncPaymentFromWorkRow(projectId, shootDayId, row.id);
  }
}
