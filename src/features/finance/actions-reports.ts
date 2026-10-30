"use server";

import {
  buildCashFlowWorkbook,
  periodLabel,
  workbookToBase64,
} from "@/features/finance/lib/export-reports-xls";
import { getCashFlowReport } from "@/features/finance/queries-reports";
import { requireProjectContext } from "@/features/projects/lib/project-context";

export type ReportExportResult =
  | { error: string; success?: undefined; base64?: undefined; fileName?: undefined }
  | {
      error?: undefined;
      success: string;
      base64: string;
      fileName: string;
    };

export async function exportCashFlowReportAction(
  projectId: string,
  payload: unknown,
): Promise<ReportExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("finance:read")) return { error: "Недостаточно прав" };

  const filters = (payload ?? {}) as {
    dateFrom?: string;
    dateTo?: string;
    companyId?: string;
    counterpartyId?: string;
  };

  const report = await getCashFlowReport(projectId, ctx, {
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    companyId: filters.companyId || undefined,
    counterpartyId: filters.counterpartyId || undefined,
  });

  const workbook = await buildCashFlowWorkbook(report, {
    projectName: ctx.project.name,
    currency: ctx.project.currency,
    periodLabel: periodLabel(filters.dateFrom, filters.dateTo),
  });
  const base64 = await workbookToBase64(workbook);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    success: "Экспорт готов",
    base64,
    fileName: `cash-flow-${stamp}.xlsx`,
  };
}
