import { AccrualReportPart, AccrualType, Prisma } from "@prisma/client";
import {
  actorNames,
  loadCounterpartyHints,
  pickCounterparty,
  type CounterpartyHints,
} from "@/features/accruals/lib/counterparty-hint";
import { sumExtrasPay } from "@/features/payroll/lib/parse-extra-payments";
import {
  computeWorkPay,
  overtimeRatesFromJson,
} from "@/features/reports/lib/compute-work-pay";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit, type AuditContext } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

/**
 * Начисления из отчёта смены: по строке отчёта — отдельное начисление на смену, переработку,
 * доплаты и км. Статья — по умолчанию у актёра / ресурса / объекта (переработка и км — свои,
 * если заданы). Строку обнулили или удалили — начисление не удаляется: сумма 0 и пометка
 * «обнулено в отчёте».
 */

const PARTS = [
  AccrualReportPart.SHIFT,
  AccrualReportPart.OVERTIME,
  AccrualReportPart.EXTRAS,
  AccrualReportPart.MILEAGE,
] as const;

const rowInclude = {
  extras: true,
  actor: {
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
      defaultBudgetItemId: true,
      overtimeBudgetItemId: true,
    },
  },
  item: {
    select: {
      id: true,
      name: true,
      defaultBudgetItemId: true,
      overtimeBudgetItemId: true,
      mileageBudgetItemId: true,
    },
  },
  location: {
    select: {
      id: true,
      name: true,
      defaultBudgetItemId: true,
      overtimeBudgetItemId: true,
    },
  },
} satisfies Prisma.ProductionReportWorkRowInclude;

type WorkRowWithSources = Prisma.ProductionReportWorkRowGetPayload<{
  include: typeof rowInclude;
}>;

type PartAmounts = {
  amount: number;
  taxAmount: number;
  amountWithTax: number;
  taxPercent: number | null;
  quantity: number | null;
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function amounts(net: number, gross: number, quantity: number | null): PartAmounts {
  const amount = round2(net);
  const amountWithTax = round2(gross);
  const taxAmount = round2(amountWithTax - amount);
  return {
    amount,
    taxAmount,
    amountWithTax,
    taxPercent: amount > 0 && taxAmount !== 0 ? round2((taxAmount / amount) * 100) : null,
    quantity,
  };
}

/** Суммы частей оплаты строки — тем же расчётом, что и в самом отчёте. */
function partsOf(row: WorkRowWithSources): Map<AccrualReportPart, PartAmounts> {
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
    overtimeRates: overtimeRatesFromJson(row.overtimeRates),
    extrasTotal: sumExtrasPay(row.extras),
    factKm: row.factKm != null ? Number(row.factKm) : null,
    kmRate: row.kmRate != null ? Number(row.kmRate) : null,
  });

  const parts = new Map<AccrualReportPart, PartAmounts>();
  if (pay.shiftPay != null && pay.shiftNet != null && pay.shiftPay > 0) {
    parts.set(AccrualReportPart.SHIFT, amounts(pay.shiftNet, pay.shiftPay, 1));
  }
  if (pay.overtimePay != null && pay.overtimeNet != null && pay.overtimePay > 0) {
    parts.set(
      AccrualReportPart.OVERTIME,
      amounts(pay.overtimeNet, pay.overtimePay, null),
    );
  }
  if (pay.extrasPay !== 0) {
    const net = row.extras.reduce((s, e) => s + Number(e.amount), 0);
    parts.set(AccrualReportPart.EXTRAS, amounts(net, pay.extrasPay, null));
  }
  if (pay.mileagePay > 0) {
    parts.set(
      AccrualReportPart.MILEAGE,
      amounts(pay.mileagePay, pay.mileagePay, row.factKm != null ? Number(row.factKm) : null),
    );
  }
  return parts;
}

/** Статья для части оплаты: переработка и км — свои, если заданы, иначе основная. */
function budgetItemFor(row: WorkRowWithSources, part: AccrualReportPart): string | null {
  const source = row.actor ?? row.item ?? row.location;
  if (!source) return null;
  const main = source.defaultBudgetItemId;
  if (part === AccrualReportPart.OVERTIME) return source.overtimeBudgetItemId ?? main;
  if (part === AccrualReportPart.MILEAGE) {
    return (row.item ? row.item.mileageBudgetItemId : null) ?? main;
  }
  return main;
}

function entityOf(row: WorkRowWithSources) {
  return {
    actorId: row.actorId,
    resourceItemId: row.resourceItemId,
    locationId: row.locationId,
    names: [
      row.displayName,
      ...(row.actor ? actorNames(row.actor) : []),
      row.item?.name ?? "",
      row.location?.name ?? "",
    ],
  };
}

function sameMoney(a: Prisma.Decimal | null, b: number | null) {
  if (a === null || b === null) return a === null && b === null;
  return a.toFixed(2) === b.toFixed(2);
}

/**
 * Привести начисления строк отчёта дня к оплате в отчёте. `rowIds` — только эти строки
 * (после правки одной строки), иначе все строки отчёта. `audit` — кто правит отчёт;
 * null — без записи в журнал (скрипт пересчёта). `dryRun` — только посчитать, что
 * изменилось бы (для плашки «Отчёт устарел»), ничего не писать.
 */
export async function syncReportAccruals(
  audit: AuditContext | null,
  projectId: string,
  shootDayId: string,
  rowIds?: readonly string[],
  options: { dryRun?: boolean } = {},
): Promise<AccrualSyncCounts> {
  const counts: AccrualSyncCounts = { created: 0, updated: 0, zeroed: 0 };
  const write = !options.dryRun;
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    select: {
      id: true,
      date: true,
      dayNumber: true,
      unit: true,
      productionReport: { select: { id: true } },
    },
  });
  if (!day?.productionReport) return counts;

  const rows = await prisma.productionReportWorkRow.findMany({
    where: {
      reportId: day.productionReport.id,
      ...(rowIds ? { id: { in: [...rowIds] } } : {}),
    },
    include: rowInclude,
  });
  if (rows.length === 0) return counts;

  const existing = await prisma.accrual.findMany({
    where: { projectId, workRowId: { in: rows.map((r) => r.id) } },
  });
  const byKey = new Map(existing.map((a) => [`${a.workRowId}:${a.reportPart}`, a]));

  let hints: CounterpartyHints | null = null;
  const counterpartyFor = async (row: WorkRowWithSources) => {
    hints ??= await loadCounterpartyHints(projectId);
    return pickCounterparty(entityOf(row), hints);
  };

  for (const row of rows) {
    const parts = partsOf(row);
    for (const part of PARTS) {
      const sums = parts.get(part);
      const accrual = byKey.get(`${row.id}:${part}`);

      if (!sums) {
        if (accrual && !accrual.amountWithTax.isZero()) {
          if (write) {
            await prisma.accrual.update({
              where: { id: accrual.id },
              data: { amount: 0, taxAmount: 0, amountWithTax: 0, reportZeroedAt: new Date() },
            });
          }
          counts.zeroed += 1;
        }
        continue;
      }

      const budgetItemId = budgetItemFor(row, part);
      if (!accrual) {
        if (write) {
          await prisma.accrual.create({
            data: {
              projectId,
              budgetItemId,
              counterpartyId: await counterpartyFor(row),
              ...sums,
              date: day.date,
              groupUnit: day.unit,
              type: AccrualType.PER_SHIFT,
              shootDayId: day.id,
              workRowId: row.id,
              reportPart: part,
              comment: `День ${day.dayNumber} · ${row.displayName}`,
              createdById: audit?.user.id ?? null,
            },
          });
        }
        counts.created += 1;
        continue;
      }

      const data: Prisma.AccrualUncheckedUpdateInput = {};
      if (!sameMoney(accrual.amount, sums.amount)) data.amount = sums.amount;
      if (!sameMoney(accrual.taxAmount, sums.taxAmount)) data.taxAmount = sums.taxAmount;
      if (!sameMoney(accrual.amountWithTax, sums.amountWithTax)) {
        data.amountWithTax = sums.amountWithTax;
      }
      if (!sameMoney(accrual.taxPercent, sums.taxPercent)) data.taxPercent = sums.taxPercent;
      if (!sameMoney(accrual.quantity, sums.quantity)) data.quantity = sums.quantity;
      if (accrual.date.getTime() !== day.date.getTime()) data.date = day.date;
      if (accrual.shootDayId !== day.id) data.shootDayId = day.id;
      if (accrual.reportZeroedAt) data.reportZeroedAt = null;
      if (!accrual.editedManually) {
        if (accrual.budgetItemId !== budgetItemId) data.budgetItemId = budgetItemId;
        if (!accrual.counterpartyId) {
          const counterpartyId = await counterpartyFor(row);
          if (counterpartyId) data.counterpartyId = counterpartyId;
        }
      }
      if (Object.keys(data).length > 0) {
        if (write) await prisma.accrual.update({ where: { id: accrual.id }, data });
        counts.updated += 1;
      }
    }
  }

  const { created, updated, zeroed } = counts;
  if (write && audit && created + updated + zeroed > 0) {
    const parts = [
      created ? `создано ${created}` : "",
      updated ? `обновлено ${updated}` : "",
      zeroed ? `обнулено ${zeroed}` : "",
    ].filter(Boolean);
    await recordAudit(audit, {
      projectId,
      entityType: AuditEntityType.accrual,
      entityId: day.id,
      action: "UPDATE",
      summary: `Начисления из отчёта смены (день ${day.dayNumber}): ${parts.join(", ")}`,
    });
  }
  return counts;
}

export type AccrualSyncCounts = { created: number; updated: number; zeroed: number };

/**
 * Строки отчёта сейчас удалят (строку убрали из дня, удалили день): их начисления не
 * удаляются — сумма 0 и пометка «обнулено в отчёте». Ссылка на строку потом пустеет сама.
 */
export async function zeroAccrualsOfWorkRows(
  audit: AuditContext | null,
  projectId: string,
  workRowIds: readonly string[],
) {
  if (workRowIds.length === 0) return;
  const { count } = await prisma.accrual.updateMany({
    where: {
      projectId,
      workRowId: { in: [...workRowIds] },
      amountWithTax: { not: 0 },
    },
    data: { amount: 0, taxAmount: 0, amountWithTax: 0, reportZeroedAt: new Date() },
  });
  if (audit && count > 0) {
    await recordAudit(audit, {
      projectId,
      entityType: AuditEntityType.accrual,
      entityId: workRowIds[0]!,
      action: "UPDATE",
      summary: `Строки отчёта смены удалены — начисления обнулены: ${count}`,
    });
  }
}
