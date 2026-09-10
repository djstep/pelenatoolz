import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";
import { stripTax } from "@/features/payroll/lib/tax-display";
import type { UsageStatementRow } from "@/features/payroll/components/overtime-history-table";
import {
  listActorOvertimeHistory,
  listResourceOvertimeHistory,
} from "@/features/payroll/queries";
import type { ProductionReportWorkExtra } from "@/features/reports/types";

export type UsageLedgerKind = "ACTOR" | "RESOURCE" | "TRANSPORT" | "LOCATION";

export type UsageLedgerBreakdown = {
  shiftPay: number;
  overtimePay: number;
  extrasPay: number;
  mileagePay: number;
  totalPay: number;
};

export type UsageLedgerSummaryRow = {
  key: string;
  kind: UsageLedgerKind;
  label: string;
  categoryLabel: string | null;
  actorId: string | null;
  resourceItemId: string | null;
  locationId: string | null;
  categoryId: string | null;
  dayCount: number;
  withTax: UsageLedgerBreakdown;
  withoutTax: UsageLedgerBreakdown;
  detailHref: string | null;
};

function emptyBreakdown(): UsageLedgerBreakdown {
  return {
    shiftPay: 0,
    overtimePay: 0,
    extrasPay: 0,
    mileagePay: 0,
    totalPay: 0,
  };
}

function addBreakdown(
  target: UsageLedgerBreakdown,
  add: UsageLedgerBreakdown,
) {
  target.shiftPay += add.shiftPay;
  target.overtimePay += add.overtimePay;
  target.extrasPay += add.extrasPay;
  target.mileagePay += add.mileagePay;
  target.totalPay += add.totalPay;
}

export async function listUsageLedgerSummary(
  projectId: string,
  locale: string,
  access?: {
    canActors: boolean;
    canLocations: boolean;
    canCategory: (categoryId: string) => boolean;
    canElementsDefault: boolean;
  },
): Promise<UsageLedgerSummaryRow[]> {
  const rows = await prisma.productionReportWorkRow.findMany({
    where: { report: { shootDay: { projectId } } },
    select: {
      kind: true,
      displayName: true,
      categoryLabel: true,
      actorId: true,
      resourceItemId: true,
      locationId: true,
      sourceKey: true,
      taxPercent: true,
      shiftPay: true,
      overtimePay: true,
      extrasPay: true,
      mileagePay: true,
      totalPay: true,
      extras: {
        select: { amount: true, totalWithTax: true },
      },
      actor: {
        select: {
          id: true,
          lastName: true,
          firstName: true,
          characterId: true,
        },
      },
      item: {
        select: {
          id: true,
          name: true,
          categoryId: true,
          category: { select: { name: true } },
        },
      },
      location: {
        select: { id: true, name: true, sublocation: true },
      },
      report: {
        select: { shootDayId: true },
      },
    },
  });

  type Agg = {
    key: string;
    kind: UsageLedgerKind;
    label: string;
    categoryLabel: string | null;
    actorId: string | null;
    resourceItemId: string | null;
    locationId: string | null;
    categoryId: string | null;
    days: Set<string>;
    withTax: UsageLedgerBreakdown;
    withoutTax: UsageLedgerBreakdown;
  };

  const map = new Map<string, Agg>();

  for (const row of rows) {
    let key: string;
    let kind: UsageLedgerKind;
    let label: string;
    let categoryLabel: string | null = row.categoryLabel;
    let actorId: string | null = row.actorId;
    let resourceItemId: string | null = row.resourceItemId;
    let locationId: string | null = row.locationId;
    let categoryId: string | null = null;

    if (row.actorId && row.actor) {
      key = `actor:${row.actorId}`;
      kind = "ACTOR";
      label = [row.actor.lastName, row.actor.firstName].filter(Boolean).join(" ");
      categoryLabel = categoryLabel || "Актёры";
    } else if (row.resourceItemId && row.item) {
      key = `resource:${row.resourceItemId}`;
      kind = "RESOURCE";
      label = row.item.name;
      categoryLabel = row.item.category.name;
      categoryId = row.item.categoryId;
    } else if (row.locationId && row.location) {
      key = `location:${row.locationId}`;
      kind = "LOCATION";
      label = row.location.sublocation
        ? `${row.location.name}.${row.location.sublocation}`
        : row.location.name;
      categoryLabel = categoryLabel || "Локации";
    } else {
      key = `transport:${row.sourceKey}`;
      kind = "TRANSPORT";
      label = row.displayName;
      categoryLabel = categoryLabel || "Спецтранспорт";
      actorId = null;
      resourceItemId = null;
      locationId = null;
    }

    let agg = map.get(key);
    if (!agg) {
      agg = {
        key,
        kind,
        label,
        categoryLabel,
        actorId,
        resourceItemId,
        locationId,
        categoryId,
        days: new Set(),
        withTax: emptyBreakdown(),
        withoutTax: emptyBreakdown(),
      };
      map.set(key, agg);
    }
    agg.days.add(row.report.shootDayId);

    const taxPct = row.taxPercent != null ? Number(row.taxPercent) : 0;
    const shiftGross = dec(row.shiftPay) ?? 0;
    const otGross = dec(row.overtimePay) ?? 0;
    const mileage = dec(row.mileagePay) ?? 0;

    const extrasGross = row.extras.reduce((s, e) => {
      const t =
        e.totalWithTax != null ? Number(e.totalWithTax) : Number(e.amount);
      return s + (Number.isFinite(t) ? t : 0);
    }, 0);
    const extrasNet = row.extras.reduce((s, e) => {
      const a = Number(e.amount);
      return s + (Number.isFinite(a) ? a : 0);
    }, 0);

    // Fallback when extras array empty but extrasPay set
    const extrasPayStored = dec(row.extrasPay) ?? 0;
    const extrasGrossFinal =
      row.extras.length > 0 ? extrasGross : extrasPayStored;
    const extrasNetFinal =
      row.extras.length > 0
        ? extrasNet
        : stripTax(extrasPayStored, taxPct) ?? 0;

    const withTaxRow: UsageLedgerBreakdown = {
      shiftPay: shiftGross,
      overtimePay: otGross,
      extrasPay: extrasGrossFinal,
      mileagePay: mileage,
      totalPay:
        shiftGross + otGross + extrasGrossFinal + mileage,
    };
    const withoutTaxRow: UsageLedgerBreakdown = {
      shiftPay: stripTax(shiftGross, taxPct) ?? 0,
      overtimePay: stripTax(otGross, taxPct) ?? 0,
      extrasPay: extrasNetFinal,
      mileagePay: mileage,
      totalPay: 0,
    };
    withoutTaxRow.totalPay =
      withoutTaxRow.shiftPay +
      withoutTaxRow.overtimePay +
      withoutTaxRow.extrasPay +
      withoutTaxRow.mileagePay;

    addBreakdown(agg.withTax, withTaxRow);
    addBreakdown(agg.withoutTax, withoutTaxRow);
  }

  const result: UsageLedgerSummaryRow[] = [...map.values()]
    .filter((agg) => {
      if (!access) return true;
      if (agg.kind === "ACTOR") return access.canActors;
      if (agg.kind === "LOCATION") return access.canLocations;
      if (agg.kind === "RESOURCE" && agg.categoryId) {
        return access.canCategory(agg.categoryId);
      }
      if (agg.kind === "TRANSPORT") {
        return access.canElementsDefault;
      }
      return false;
    })
    .map((agg) => {
    let detailHref: string | null = null;
    if (agg.kind === "ACTOR" && agg.actorId) {
      detailHref = `/${locale}/projects/${projectId}/resource-usage/actors/${agg.actorId}`;
    } else if (agg.kind === "RESOURCE" && agg.resourceItemId) {
      detailHref = `/${locale}/projects/${projectId}/resource-usage/resources/${agg.resourceItemId}`;
    } else if (agg.kind === "LOCATION" && agg.locationId) {
      detailHref = `/${locale}/projects/${projectId}/locations/${agg.locationId}`;
    }

    return {
      key: agg.key,
      kind: agg.kind,
      label: agg.label,
      categoryLabel: agg.categoryLabel,
      actorId: agg.actorId,
      resourceItemId: agg.resourceItemId,
      locationId: agg.locationId,
      categoryId: agg.categoryId,
      dayCount: agg.days.size,
      withTax: agg.withTax,
      withoutTax: agg.withoutTax,
      detailHref,
    };
  });

  result.sort((a, b) => {
    const kindOrder: Record<UsageLedgerKind, number> = {
      ACTOR: 0,
      RESOURCE: 1,
      TRANSPORT: 2,
      LOCATION: 3,
    };
    if (kindOrder[a.kind] !== kindOrder[b.kind]) {
      return kindOrder[a.kind] - kindOrder[b.kind];
    }
    const cat = (a.categoryLabel ?? "").localeCompare(b.categoryLabel ?? "", "ru");
    if (cat !== 0) return cat;
    return a.label.localeCompare(b.label, "ru");
  });

  return result;
}

export async function getUsageLedgerActorDetail(
  projectId: string,
  actorId: string,
): Promise<{
  title: string;
  subtitle: string | null;
  characterId: string | null;
  rows: UsageStatementRow[];
} | null> {
  const actor = await prisma.actor.findFirst({
    where: { id: actorId, projectId },
    select: {
      id: true,
      lastName: true,
      firstName: true,
      characterId: true,
      character: { select: { name: true } },
    },
  });
  if (!actor) return null;

  const rows = await listActorOvertimeHistory(projectId, actorId);
  return {
    title: [actor.lastName, actor.firstName].filter(Boolean).join(" "),
    subtitle: actor.character?.name ?? null,
    characterId: actor.characterId,
    rows,
  };
}

export async function getUsageLedgerResourceDetail(
  projectId: string,
  resourceItemId: string,
): Promise<{
  title: string;
  subtitle: string | null;
  categoryId: string;
  rows: UsageStatementRow[];
} | null> {
  const item = await prisma.resourceItem.findFirst({
    where: { id: resourceItemId, category: { projectId } },
    select: {
      id: true,
      name: true,
      categoryId: true,
      category: { select: { name: true } },
    },
  });
  if (!item) return null;

  const rows = await listResourceOvertimeHistory(projectId, resourceItemId);
  return {
    title: item.name,
    subtitle: item.category.name,
    categoryId: item.categoryId,
    rows,
  };
}

export type { ProductionReportWorkExtra };
