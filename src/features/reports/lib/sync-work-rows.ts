import type { Prisma } from "@prisma/client";
import { sumExtrasPay } from "@/features/payroll/lib/parse-extra-payments";
import { prisma } from "@/shared/db/prisma";
import {
  computeWorkPay,
  OVERTIME_MODE_LABELS,
  UNPAID_OT_MODE_LABELS,
} from "@/features/reports/lib/compute-work-pay";
import {
  syncReportAccruals,
  zeroAccrualsOfWorkRows,
} from "@/features/reports/lib/sync-accruals";
import type { AuditContext } from "@/shared/audit/with-audit";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
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

/** Строки, которые должны быть в отчёте дня по КПП и карточкам. Ничего не пишет. */
async function loadCandidates(projectId: string, shootDayId: string) {
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
  if (!day) return null;

  const characterIds = new Set<string>();
  for (const row of day.scenes) {
    for (const link of row.scene.characters) characterIds.add(link.characterId);
  }

  const [actors, locationRates] = await Promise.all([
    prisma.actor.findMany({
      where: { projectId, characterId: { in: [...characterIds] } },
      include: {
        overtimeRates: true,
        character: { select: { name: true } },
      },
    }),
    prisma.locationOvertimeRate.findMany({
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
    }),
  ]);
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

  function ratesFor(c: SeedCandidate): RateRow[] {
    if (c.actorId) {
      const actor = actors.find((a) => a.id === c.actorId);
      return mapRates(actor?.overtimeRates ?? []);
    }
    if (c.resourceItemId) return resourceRatesByItemId.get(c.resourceItemId) ?? [];
    if (c.locationId) return mapRates(locationRatesById.get(c.locationId) ?? []);
    return [];
  }

  return { candidates, ratesFor };
}

type ExistingRow = Prisma.ProductionReportWorkRowGetPayload<{
  include: {
    extras: true;
    actor: { include: { overtimeRates: true } };
    item: { include: { overtimeRates: true } };
    location: { include: { overtimeRates: true } };
  };
}>;

/** Ставки, налог и режимы строки — меняются при обновлении только с галочкой. */
type RateFields = {
  shiftRate: number | null;
  taxPercent: number | null;
  shiftHoursMin: number | null;
  unpaidOvertimeMin: number | null;
  overtimeMode: SeedCandidate["overtimeMode"];
  unpaidOvertimeMode: SeedCandidate["unpaidOvertimeMode"];
  tracksMileage: boolean;
  kmRate: number | null;
};

function candidateRates(c: SeedCandidate, prev?: ExistingRow): RateFields {
  return {
    shiftRate: c.shiftRate ?? null,
    taxPercent: c.taxPercent ?? null,
    shiftHoursMin: c.shiftHoursMin ?? null,
    unpaidOvertimeMin: c.unpaidOvertimeMin ?? null,
    overtimeMode: c.overtimeMode ?? null,
    unpaidOvertimeMode: c.unpaidOvertimeMode ?? null,
    tracksMileage: Boolean(c.tracksMileage) || c.kind === "TRANSPORT",
    kmRate: c.kmRate ?? (prev?.kmRate != null ? Number(prev.kmRate) : null),
  };
}

function rowRates(row: ExistingRow): RateFields {
  return {
    shiftRate: dec(row.shiftRate),
    taxPercent: dec(row.taxPercent),
    shiftHoursMin: row.shiftHoursMin,
    unpaidOvertimeMin: row.unpaidOvertimeMin,
    overtimeMode: row.overtimeMode,
    unpaidOvertimeMode: row.unpaidOvertimeMode,
    tracksMileage: row.tracksMileage,
    kmRate: dec(row.kmRate),
  };
}

function money(n: number | null) {
  return n == null ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

const RATE_LABELS: { key: keyof RateFields; label: string; show: (v: RateFields) => string }[] = [
  { key: "shiftRate", label: "Ставка смены", show: (v) => money(v.shiftRate) },
  { key: "taxPercent", label: "Налог, %", show: (v) => money(v.taxPercent) },
  {
    key: "shiftHoursMin",
    label: "Длительность смены",
    show: (v) => formatMinutesHhMm(v.shiftHoursMin) || "—",
  },
  {
    key: "unpaidOvertimeMin",
    label: "Неоплачиваемая переработка",
    show: (v) => formatMinutesHhMm(v.unpaidOvertimeMin) || "—",
  },
  {
    key: "overtimeMode",
    label: "Режим переработки",
    show: (v) => (v.overtimeMode ? OVERTIME_MODE_LABELS[v.overtimeMode] : "—"),
  },
  {
    key: "unpaidOvertimeMode",
    label: "Неоплачиваемая — считать",
    show: (v) => (v.unpaidOvertimeMode ? UNPAID_OT_MODE_LABELS[v.unpaidOvertimeMode] : "—"),
  },
  { key: "tracksMileage", label: "Учёт км", show: (v) => (v.tracksMileage ? "да" : "нет") },
  { key: "kmRate", label: "Ставка за км", show: (v) => money(v.kmRate) },
];

function sameValue(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  return a === b;
}

function payOf(
  row: Pick<ExistingRow, "factStart" | "factEnd" | "lunchSkipped" | "factKm" | "extras">,
  rates: RateFields,
  overtimeRates: RateRow[],
) {
  return computeWorkPay({
    factStart: row.factStart,
    factEnd: row.factEnd,
    lunchSkipped: row.lunchSkipped,
    shiftHoursMin: rates.shiftHoursMin,
    unpaidOvertimeMin: rates.unpaidOvertimeMin,
    shiftRate: rates.shiftRate,
    taxPercent: rates.taxPercent,
    overtimeMode: rates.overtimeMode,
    unpaidOvertimeMode: rates.unpaidOvertimeMode,
    overtimeRates,
    extrasTotal: sumExtrasPay(row.extras),
    factKm: row.factKm != null ? Number(row.factKm) : null,
    kmRate: rates.kmRate,
  });
}

function overtimeRatesOf(row: ExistingRow): RateRow[] {
  return mapRates(
    row.actor?.overtimeRates ?? row.item?.overtimeRates ?? row.location?.overtimeRates ?? [],
  );
}

export type WorkRowRateChange = {
  rowId: string;
  name: string;
  fields: { label: string; before: string; after: string }[];
  /** Оплата строки с налогом: сейчас и после обновления ставок */
  pay: { before: string; after: string };
};

export type WorkRowSyncPlan = {
  /** Новые строки из КПП */
  added: string[];
  /** Строки, которых больше нет в КПП: удалятся, их начисления обнулятся */
  removed: string[];
  /** Ставки, налог, режимы в карточках отличаются от строки — меняются только с галочкой */
  rateChanges: WorkRowRateChange[];
  /** Изменятся без галочки: название, категория, время из вызывного в пустых строках, оплата */
  otherChanged: string[];
};

type LoadedPlan = WorkRowSyncPlan & {
  candidates: SeedCandidate[];
  ratesFor: (c: SeedCandidate) => RateRow[];
  existing: ExistingRow[];
};

async function loadPlan(
  projectId: string,
  shootDayId: string,
  reportId: string | null,
): Promise<LoadedPlan | null> {
  const [loaded, existing] = await Promise.all([
    loadCandidates(projectId, shootDayId),
    reportId
      ? prisma.productionReportWorkRow.findMany({
          where: { reportId },
          include: {
            extras: true,
            actor: { include: { overtimeRates: true } },
            item: { include: { overtimeRates: true } },
            location: { include: { overtimeRates: true } },
          },
        })
      : Promise.resolve([] as ExistingRow[]),
  ]);
  if (!loaded) return null;
  const { candidates, ratesFor } = loaded;
  const existingByKey = new Map(existing.map((r) => [r.sourceKey, r]));
  const keepKeys = new Set(candidates.map((c) => c.sourceKey));

  const rateChanges: WorkRowRateChange[] = [];
  const otherChanged: string[] = [];
  for (const c of candidates) {
    const prev = existingByKey.get(c.sourceKey);
    if (!prev) continue;

    const before = rowRates(prev);
    const after = candidateRates(c, prev);
    const fields = RATE_LABELS.filter((f) => !sameValue(before[f.key], after[f.key])).map(
      (f) => ({ label: f.label, before: f.show(before), after: f.show(after) }),
    );
    const times = timesAfterRefresh(prev, c);
    const row = { ...prev, factStart: times.factStart, factEnd: times.factEnd };
    if (fields.length > 0) {
      rateChanges.push({
        rowId: prev.id,
        name: prev.displayName,
        fields,
        pay: {
          before: money(dec(prev.totalPay)),
          after: money(payOf(row, after, overtimeRatesOf(prev)).totalPay),
        },
      });
    }

    const payKeepingRates = payOf(row, before, overtimeRatesOf(prev)).totalPay;
    if (
      prev.displayName !== c.displayName ||
      prev.categoryLabel !== c.categoryLabel ||
      prev.factStart !== times.factStart ||
      prev.factEnd !== times.factEnd ||
      !sameValue(dec(prev.totalPay), payKeepingRates)
    ) {
      otherChanged.push(prev.displayName);
    }
  }

  return {
    candidates,
    ratesFor,
    existing,
    added: candidates.filter((c) => !existingByKey.has(c.sourceKey)).map((c) => c.displayName),
    removed: existing.filter((r) => !keepKeys.has(r.sourceKey)).map((r) => r.displayName),
    rateChanges,
    otherChanged,
  };
}

/** Пустое время строки берётся из вызывного; заполненное не трогается. */
function timesAfterRefresh(prev: ExistingRow, c: SeedCandidate) {
  return {
    factStart: prev.factStart?.trim() ? prev.factStart : c.factStart || null,
    factEnd: prev.factEnd?.trim() ? prev.factEnd : c.factEnd || null,
  };
}

/** Что изменит «Обновить из КПП» в строках работы. Ничего не пишет. */
export async function planWorkRowSync(
  projectId: string,
  shootDayId: string,
  reportId: string | null,
): Promise<WorkRowSyncPlan | null> {
  const plan = await loadPlan(projectId, shootDayId, reportId);
  if (!plan) return null;
  const { added, removed, rateChanges, otherChanged } = plan;
  return { added, removed, rateChanges, otherChanged };
}

/**
 * «Обновить из КПП» для строк работы: новые строки добавляются, убранные из КПП удаляются
 * (их начисления обнуляются), у существующих ставки, налог и режимы меняются только при
 * `updateRates`. Потом пересчёт оплаты и начислений. `audit` — кто нажал.
 */
export async function applyWorkRowSync(
  audit: AuditContext,
  projectId: string,
  shootDayId: string,
  reportId: string,
  options: { updateRates: boolean },
): Promise<WorkRowSyncPlan | null> {
  const plan = await loadPlan(projectId, shootDayId, reportId);
  if (!plan) return null;
  const { candidates, ratesFor, existing } = plan;
  const existingByKey = new Map(existing.map((r) => [r.sourceKey, r]));
  const keepKeys = new Set(candidates.map((c) => c.sourceKey));

  const removed = existing.filter((row) => !keepKeys.has(row.sourceKey));
  await zeroAccrualsOfWorkRows(
    audit,
    projectId,
    removed.map((row) => row.id),
  );
  for (const row of removed) {
    await prisma.productionReportWorkRow.delete({ where: { id: row.id } });
  }

  for (const c of candidates) {
    const prev = existingByKey.get(c.sourceKey);
    if (prev) {
      const times = timesAfterRefresh(prev, c);
      const rates = options.updateRates ? candidateRates(c, prev) : rowRates(prev);
      const pay = payOf({ ...prev, ...times }, rates, overtimeRatesOf(prev));
      await prisma.productionReportWorkRow.update({
        where: { id: prev.id },
        data: {
          displayName: c.displayName,
          categoryLabel: c.categoryLabel,
          actorId: c.actorId ?? null,
          resourceItemId: c.resourceItemId ?? null,
          locationId: c.locationId ?? null,
          ...times,
          sortOrder: c.sortOrder,
          ...(options.updateRates ? rates : {}),
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
      continue;
    }

    const rates = candidateRates(c);
    const times = { factStart: c.factStart || null, factEnd: c.factEnd || null };
    const pay = payOf(
      { ...times, lunchSkipped: false, factKm: null, extras: [] },
      rates,
      ratesFor(c),
    );
    const data: Prisma.ProductionReportWorkRowUncheckedCreateInput = {
      reportId,
      kind: c.kind,
      sourceKey: c.sourceKey,
      displayName: c.displayName,
      categoryLabel: c.categoryLabel,
      actorId: c.actorId ?? null,
      resourceItemId: c.resourceItemId ?? null,
      locationId: c.locationId ?? null,
      ...times,
      lunchSkipped: false,
      ...rates,
      workedMin: pay.workedMin,
      factOvertimeMin: pay.factOvertimeMin,
      payableOvertimeMin: pay.payableOvertimeMin,
      mileagePay: pay.mileagePay,
      shiftPay: pay.shiftPay,
      overtimePay: pay.overtimePay,
      extrasPay: pay.extrasPay,
      totalPay: pay.totalPay,
      sortOrder: c.sortOrder,
    };
    await prisma.productionReportWorkRow.create({ data });
  }

  await syncReportAccruals(audit, projectId, shootDayId);
  const { added, rateChanges, otherChanged } = plan;
  return { added, removed: plan.removed, rateChanges, otherChanged };
}
