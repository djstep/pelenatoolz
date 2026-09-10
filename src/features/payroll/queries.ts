import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";
import type { UsageStatementRow } from "@/features/payroll/components/overtime-history-table";
import type { ProductionReportWorkExtra } from "@/features/reports/types";

function mapUsageRow(r: {
  id: string;
  displayName: string;
  workedMin: number | null;
  factOvertimeMin: number | null;
  payableOvertimeMin: number | null;
  overtimePay: unknown;
  extrasPay: unknown;
  totalPay: unknown;
  taxPercent: unknown;
  extras: Array<{
    id: string;
    workRowId: string;
    amount: unknown;
    taxPercent: unknown;
    taxAmount: unknown;
    totalWithTax: unknown;
    description: string | null;
  }>;
  report: {
    shootDay: { id: string; dayNumber: number; date: Date };
  };
}): UsageStatementRow {
  const extras: ProductionReportWorkExtra[] = r.extras.map((e) => ({
    id: e.id,
    workRowId: e.workRowId,
    amount: Number(e.amount),
    taxPercent: e.taxPercent != null ? Number(e.taxPercent) : null,
    taxAmount: e.taxAmount != null ? Number(e.taxAmount) : null,
    totalWithTax: e.totalWithTax != null ? Number(e.totalWithTax) : null,
    description: e.description,
  }));
  const extrasPay = dec(r.extrasPay as number | { toString(): string } | null);
  return {
    workRowId: r.id,
    dayId: r.report.shootDay.id,
    dayNumber: r.report.shootDay.dayNumber,
    date: r.report.shootDay.date,
    displayName: r.displayName,
    workedMin: r.workedMin,
    factOvertimeMin: r.factOvertimeMin,
    payableOvertimeMin: r.payableOvertimeMin,
    overtimePay: dec(r.overtimePay as number | { toString(): string } | null),
    extrasPay,
    totalPay: dec(r.totalPay as number | { toString(): string } | null),
    taxPercent: r.taxPercent != null ? Number(r.taxPercent) : null,
    hasExtras: extras.length > 0 || (extrasPay != null && extrasPay !== 0),
    extras,
  };
}

const usageSelect = {
  id: true,
  displayName: true,
  workedMin: true,
  factOvertimeMin: true,
  payableOvertimeMin: true,
  overtimePay: true,
  extrasPay: true,
  totalPay: true,
  taxPercent: true,
  extras: { orderBy: { createdAt: "asc" as const } },
  report: {
    select: {
      shootDay: {
        select: { id: true, dayNumber: true, date: true },
      },
    },
  },
} as const;

export async function listActorOvertimeHistory(
  projectId: string,
  actorId: string,
): Promise<UsageStatementRow[]> {
  const rows = await prisma.productionReportWorkRow.findMany({
    where: {
      actorId,
      report: { shootDay: { projectId } },
    },
    select: usageSelect,
    orderBy: { report: { shootDay: { date: "desc" } } },
    take: 200,
  });

  return rows.map(mapUsageRow);
}

export async function listResourceOvertimeHistory(
  projectId: string,
  resourceItemId: string,
): Promise<UsageStatementRow[]> {
  const rows = await prisma.productionReportWorkRow.findMany({
    where: {
      resourceItemId,
      report: { shootDay: { projectId } },
    },
    select: usageSelect,
    orderBy: { report: { shootDay: { date: "desc" } } },
    take: 200,
  });

  return rows.map(mapUsageRow);
}
