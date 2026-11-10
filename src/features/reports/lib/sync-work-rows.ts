import type { Prisma } from "@prisma/client";
import { sumExtrasPay } from "@/features/payroll/lib/parse-extra-payments";
import { prisma } from "@/shared/db/prisma";
import { formatLocationTitle } from "@/features/locations/lib/format-location";
import { LOCATION_PARENT_SELECT } from "@/features/locations/lib/location-fields";
import {
  computeWorkPay,
  OVERTIME_MODE_LABELS,
  overtimeRatesFromJson,
  UNPAID_OT_MODE_LABELS,
} from "@/features/reports/lib/compute-work-pay";
import {
  syncReportAccruals,
  zeroAccrualsOfWorkRows,
} from "@/features/reports/lib/sync-accruals";
import type { AuditContext } from "@/shared/audit/with-audit";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { dec } from "@/shared/db/serialize-decimal";
import {
  newRowFields,
  refreshedRowFields,
  splitWorkRows,
  timesAfterRefresh,
  transportCandidate,
  type SeedCandidate,
} from "@/features/reports/lib/work-row-sync-rules";

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
                      parent: LOCATION_PARENT_SELECT,
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
    candidates.push(transportCandidate({ ...t, kmRate: dec(t.kmRate) }, order++));
  }

  const seenLocations = new Set<string>();
  for (const row of day.scenes) {
    for (const link of row.scene.locations) {
      if (seenLocations.has(link.locationId)) continue;
      seenLocations.add(link.locationId);
      const loc = link.location;
      const label = formatLocationTitle(loc);
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
  include: { extras: true };
}>;

/**
 * Ставки, налог, режимы и почасовые ставки переработки строки — снимок с карточки.
 * При обновлении из КПП меняются только с галочкой «Обновить ставки из карточек».
 */
type RateFields = {
  shiftRate: number | null;
  taxPercent: number | null;
  shiftHoursMin: number | null;
  unpaidOvertimeMin: number | null;
  overtimeMode: SeedCandidate["overtimeMode"];
  unpaidOvertimeMode: SeedCandidate["unpaidOvertimeMode"];
  tracksMileage: boolean;
  kmRate: number | null;
  overtimeRates: RateRow[];
};

function candidateRates(c: SeedCandidate, overtimeRates: RateRow[], prev?: ExistingRow): RateFields {
  return {
    shiftRate: c.shiftRate ?? null,
    taxPercent: c.taxPercent ?? null,
    shiftHoursMin: c.shiftHoursMin ?? null,
    unpaidOvertimeMin: c.unpaidOvertimeMin ?? null,
    overtimeMode: c.overtimeMode ?? null,
    unpaidOvertimeMode: c.unpaidOvertimeMode ?? null,
    tracksMileage: Boolean(c.tracksMileage) || c.kind === "TRANSPORT",
    kmRate: c.kmRate ?? (prev?.kmRate != null ? Number(prev.kmRate) : null),
    overtimeRates: [...overtimeRates].sort((a, b) => a.hourNumber - b.hourNumber),
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
    overtimeRates: overtimeRatesFromJson(row.overtimeRates),
  };
}

/** Поля для записи в строку (почасовые ставки — JSON). */
function rateData(rates: RateFields) {
  return { ...rates, overtimeRates: rates.overtimeRates as Prisma.InputJsonValue };
}

function money(n: number | null) {
  return n == null ? "—" : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/** «1 ч: 150%, 2 ч: 7 500 (13%)» — для таблицы «было → стало». */
function showOvertimeRates(rates: RateRow[]) {
  const filled = rates.filter((r) => r.percentRate != null || r.amount != null);
  if (filled.length === 0) return "нет";
  return filled
    .map((r) => {
      const value = r.percentRate != null ? `${money(r.percentRate)}%` : money(r.amount);
      const tax = r.taxPercent != null ? ` (налог ${money(r.taxPercent)}%)` : "";
      return `${r.hourNumber} ч: ${value}${tax}`;
    })
    .join(", ");
}

function sameOvertimeRates(a: RateRow[], b: RateRow[]) {
  return showOvertimeRates(a) === showOvertimeRates(b);
}

const RATE_LABELS: {
  key: keyof RateFields;
  label: string;
  show: (v: RateFields) => string;
}[] = [
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
  {
    key: "overtimeRates",
    label: "Ставки переработки по часам",
    show: (v) => showOvertimeRates(v.overtimeRates),
  },
];

function sameValue(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 0.005;
  if (Array.isArray(a) && Array.isArray(b)) return sameOvertimeRates(a, b);
  return a === b;
}

function payOf(
  row: Pick<ExistingRow, "factStart" | "factEnd" | "lunchSkipped" | "factKm" | "extras">,
  rates: RateFields,
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
    overtimeRates: rates.overtimeRates,
    extrasTotal: sumExtrasPay(row.extras),
    factKm: row.factKm != null ? Number(row.factKm) : null,
    kmRate: rates.kmRate,
  });
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
          include: { extras: true },
        })
      : Promise.resolve([] as ExistingRow[]),
  ]);
  if (!loaded) return null;
  const { candidates, ratesFor } = loaded;
  const split = splitWorkRows(candidates, existing);

  const rateChanges: WorkRowRateChange[] = [];
  const otherChanged: string[] = [];
  for (const { prev, c } of split.kept) {
    const before = rowRates(prev);
    const after = candidateRates(c, ratesFor(c), prev);
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
          after: money(payOf(row, after).totalPay),
        },
      });
    }

    const payKeepingRates = payOf(row, before).totalPay;
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
    added: split.added.map((c) => c.displayName),
    removed: split.removed.map((r) => r.displayName),
    rateChanges,
    otherChanged,
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
  const { kept, removed } = splitWorkRows(candidates, existing);
  const keptByKey = new Map(kept.map(({ prev }) => [prev.sourceKey, prev]));

  await zeroAccrualsOfWorkRows(
    audit,
    projectId,
    removed.map((row) => row.id),
  );
  for (const row of removed) {
    await prisma.productionReportWorkRow.delete({ where: { id: row.id } });
  }

  for (const c of candidates) {
    const prev = keptByKey.get(c.sourceKey);
    if (prev) {
      // Статья строки (снимок спецтранспорта) и факт км здесь не меняются никогда.
      const fields = refreshedRowFields(prev, c);
      const rates = options.updateRates ? candidateRates(c, ratesFor(c), prev) : rowRates(prev);
      const pay = payOf({ ...prev, ...fields }, rates);
      await prisma.productionReportWorkRow.update({
        where: { id: prev.id },
        data: {
          ...fields,
          ...(options.updateRates ? rateData(rates) : {}),
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

    const rates = candidateRates(c, ratesFor(c));
    // Статья спецтранспорта попадает в строку только здесь — при создании.
    const fields = newRowFields(reportId, c);
    const pay = payOf({ ...fields, factKm: null, extras: [] }, rates);
    const data: Prisma.ProductionReportWorkRowUncheckedCreateInput = {
      ...fields,
      ...rateData(rates),
      workedMin: pay.workedMin,
      factOvertimeMin: pay.factOvertimeMin,
      payableOvertimeMin: pay.payableOvertimeMin,
      mileagePay: pay.mileagePay,
      shiftPay: pay.shiftPay,
      overtimePay: pay.overtimePay,
      extrasPay: pay.extrasPay,
      totalPay: pay.totalPay,
    };
    await prisma.productionReportWorkRow.create({ data });
  }

  await syncReportAccruals(audit, projectId, shootDayId);
  const { added, rateChanges, otherChanged } = plan;
  return { added, removed: plan.removed, rateChanges, otherChanged };
}
