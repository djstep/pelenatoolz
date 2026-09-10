import type { Prisma } from "@prisma/client";
import { sumExtrasPay } from "@/features/payroll/lib/parse-extra-payments";
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
  taxPercent?: number | null;
  overtimeMode?: "HALF_HOUR" | "HOURLY_CUMULATIVE" | "HOURLY_FLAT" | null;
  unpaidOvertimeMode?: "FIRST_HOUR" | "EACH_HOUR" | null;
  tracksMileage?: boolean;
  kmRate?: number | null;
  sortOrder: number;
};

function actorName(a: {
  lastName: string;
  firstName: string | null;
  middleName: string | null;
}) {
  return [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" ");
}

type RateRow = {
  hourNumber: number;
  percentRate: number | null;
  amount: number | null;
  taxPercent: number | null;
};

function mapRates(
  rates: Array<{
    hourNumber: number;
    percentRate: unknown;
    amount: unknown;
    taxPercent: unknown;
  }>,
): RateRow[] {
  return rates.map((r) => ({
    hourNumber: r.hourNumber,
    percentRate: dec(r.percentRate as { toString(): string } | null),
    amount: dec(r.amount as { toString(): string } | null),
    taxPercent: dec(r.taxPercent as { toString(): string } | null),
  }));
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
                  location: {
                    select: {
                      id: true,
                      name: true,
                      sublocation: true,
                      shiftRate: true,
                      shiftHoursMin: true,
                      unpaidOvertimeMin: true,
                      taxPercent: true,
                      overtimeMode: true,
                      unpaidOvertimeMode: true,
                    },
                  },
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
                      taxPercent: true,
                      overtimeMode: true,
                      unpaidOvertimeMode: true,
                      kmRate: true,
                      category: { select: { name: true, perShift: true, tracksMileage: true } },
                      overtimeRates: true,
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
            include: {
              category: { select: { name: true, perShift: true, tracksMileage: true } },
              overtimeRates: true,
            },
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

  const locationRates = await prisma.locationOvertimeRate.findMany({
    where: {
      locationId: {
        in: [
          ...new Set(
            day.scenes.flatMap((s) =>
              s.scene.locations.map((l) => l.locationId),
            ),
          ),
        ],
      },
    },
  });
  const locationRatesById = new Map<string, typeof locationRates>();
  for (const r of locationRates) {
    const list = locationRatesById.get(r.locationId) ?? [];
    list.push(r);
    locationRatesById.set(r.locationId, list);
  }

  const resourceRatesByItemId = new Map<string, RateRow[]>();

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
      taxPercent: dec(actor.taxPercent),
      overtimeMode: actor.overtimeMode,
      unpaidOvertimeMode: actor.unpaidOvertimeMode,
      sortOrder: order++,
    });
  }

  const seenResources = new Set<string>();
  for (const usage of day.resourceUsages) {
    const key = `resource:${usage.itemId}`;
    if (seenResources.has(key)) continue;
    seenResources.add(key);
    resourceRatesByItemId.set(
      usage.itemId,
      mapRates(usage.item.overtimeRates),
    );
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
      taxPercent: dec(usage.item.taxPercent),
      overtimeMode: usage.item.overtimeMode,
      unpaidOvertimeMode: usage.item.unpaidOvertimeMode,
      tracksMileage: usage.item.category.tracksMileage,
      kmRate: dec(usage.item.kmRate),
      sortOrder: order++,
    });
  }

  for (const row of day.scenes) {
    for (const link of row.scene.resourceItems) {
      if (link.item.category.perShift) continue;
      const key = `resource:${link.itemId}`;
      if (seenResources.has(key)) continue;
      seenResources.add(key);
      resourceRatesByItemId.set(link.itemId, mapRates(link.item.overtimeRates));
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
        taxPercent: dec(link.item.taxPercent),
        overtimeMode: link.item.overtimeMode,
        unpaidOvertimeMode: link.item.unpaidOvertimeMode,
        tracksMileage: link.item.category.tracksMileage,
        kmRate: dec(link.item.kmRate),
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
      taxPercent: null,
      tracksMileage: true,
      kmRate: dec(t.kmRate),
      sortOrder: order++,
    });
  }

  const seenLocations = new Set<string>();
  for (const row of day.scenes) {
    for (const link of row.scene.locations) {
      if (seenLocations.has(link.locationId)) continue;
      seenLocations.add(link.locationId);
      const loc = link.location;
      const label = loc.sublocation
        ? `${loc.name}.${loc.sublocation}`
        : loc.name;
      candidates.push({
        sourceKey: `location:${link.locationId}`,
        kind: "LOCATION",
        displayName: label,
        categoryLabel: "Локация",
        locationId: link.locationId,
        factStart: null,
        factEnd: null,
        shiftHoursMin: loc.shiftHoursMin,
        unpaidOvertimeMin: loc.unpaidOvertimeMin,
        shiftRate: dec(loc.shiftRate),
        taxPercent: dec(loc.taxPercent),
        overtimeMode: loc.overtimeMode,
        unpaidOvertimeMode: loc.unpaidOvertimeMode,
        sortOrder: order++,
      });
    }
  }

  const existing = await prisma.productionReportWorkRow.findMany({
    where: { reportId },
  });
  const existingByKey = new Map(existing.map((r) => [r.sourceKey, r]));
  const keepKeys = new Set(candidates.map((c) => c.sourceKey));

  for (const row of existing) {
    if (!keepKeys.has(row.sourceKey)) {
      await prisma.productionReportWorkRow.delete({ where: { id: row.id } });
    }
  }

  for (const c of candidates) {
    const prev = existingByKey.get(c.sourceKey);
    const factStart = prev?.factStart || c.factStart || null;
    const factEnd = prev?.factEnd || c.factEnd || null;
    const lunchSkipped = prev?.lunchSkipped ?? false;

    let overtimeRates: RateRow[] = [];
    if (c.actorId) {
      const actor = actors.find((a) => a.id === c.actorId);
      overtimeRates = mapRates(actor?.overtimeRates ?? []);
    } else if (c.resourceItemId) {
      overtimeRates = resourceRatesByItemId.get(c.resourceItemId) ?? [];
    } else if (c.locationId) {
      overtimeRates = mapRates(locationRatesById.get(c.locationId) ?? []);
    }

    const factKm = prev?.factKm != null ? Number(prev.factKm) : null;
    const kmRate = c.kmRate ?? (prev?.kmRate != null ? Number(prev.kmRate) : null);
    const tracksMileage = Boolean(c.tracksMileage) || c.kind === "TRANSPORT";

    const pay = computeWorkPay({
      factStart,
      factEnd,
      lunchSkipped,
      shiftHoursMin: c.shiftHoursMin,
      unpaidOvertimeMin: c.unpaidOvertimeMin,
      shiftRate: c.shiftRate,
      taxPercent: c.taxPercent,
      overtimeMode: c.overtimeMode,
      unpaidOvertimeMode: c.unpaidOvertimeMode,
      overtimeRates,
      extrasTotal: 0,
      factKm,
      kmRate,
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
      taxPercent: c.taxPercent ?? null,
      overtimeMode: c.overtimeMode ?? null,
      unpaidOvertimeMode: c.unpaidOvertimeMode ?? null,
      tracksMileage,
      factKm,
      kmRate,
      mileagePay: pay.mileagePay,
      shiftPay: pay.shiftPay,
      overtimePay: pay.overtimePay,
      extrasPay: pay.extrasPay,
      totalPay: pay.totalPay,
      sortOrder: c.sortOrder,
    };

    if (prev) {
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
          taxPercent: c.taxPercent ?? null,
          overtimeMode: c.overtimeMode ?? null,
          unpaidOvertimeMode: c.unpaidOvertimeMode ?? null,
          tracksMileage,
          kmRate,
          sortOrder: c.sortOrder,
        },
      });
    } else {
      await prisma.productionReportWorkRow.create({ data });
    }
  }

  const { syncPaymentFromWorkRow } = await import(
    "@/features/reports/lib/sync-payment"
  );
  const rows = await prisma.productionReportWorkRow.findMany({
    where: { reportId },
    include: {
      extras: true,
      actor: { include: { overtimeRates: true } },
      item: { include: { overtimeRates: true } },
      location: { include: { overtimeRates: true } },
    },
  });

  for (const row of rows) {
    const extrasTotal = sumExtrasPay(row.extras);
    const rates = mapRates(
      row.actor?.overtimeRates ??
        row.item?.overtimeRates ??
        row.location?.overtimeRates ??
        [],
    );
    const pay = computeWorkPay({
      factStart: row.factStart,
      factEnd: row.factEnd,
      lunchSkipped: row.lunchSkipped,
      shiftHoursMin: row.shiftHoursMin,
      unpaidOvertimeMin: row.unpaidOvertimeMin,
      shiftRate: dec(row.shiftRate),
      taxPercent: dec(row.taxPercent),
      overtimeMode: row.overtimeMode,
      unpaidOvertimeMode: row.unpaidOvertimeMode,
      overtimeRates: rates,
      extrasTotal,
      factKm: row.factKm != null ? Number(row.factKm) : null,
      kmRate: row.kmRate != null ? Number(row.kmRate) : null,
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
        mileagePay: pay.mileagePay,
        totalPay: pay.totalPay,
      },
    });
    await syncPaymentFromWorkRow(projectId, shootDayId, row.id);
  }
}
