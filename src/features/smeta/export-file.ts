import "server-only";

import ExcelJS from "exceljs";
import type { ExportColumn } from "@/features/exports/types";
import { summaryDriveModeLabel } from "@/features/cloud/lib/budget-drive-export-rules";
import { loadItemsSnapshot } from "@/features/smeta/approval-queries";
import { loadDepartmentBudgetExport, type DepartmentBudgetExport } from "@/features/smeta/export-queries";
import { getItemsSummaryForExport } from "@/features/smeta/items-summary-queries";
import {
  buildDepartmentBudgetWorkbook,
  departmentExportInfo,
} from "@/features/smeta/lib/export-department-xlsx";
import { addExportInfoSheet, formatExportDateTime } from "@/features/smeta/lib/export-info-sheet";
import {
  addItemsSheet,
  addSheetVersionLines,
  addSummarySheet,
  smetaDefaultExportColumns,
} from "@/features/smeta/lib/items-export-xlsx";
import type { SmetaAccessContext } from "@/features/smeta/lib/smeta-access";
import { getPlanFact } from "@/features/smeta/plan-fact-queries";
import { prisma } from "@/shared/db/prisma";

export type DepartmentBudgetFile = {
  content: Buffer;
  department: { name: string; codePrefix: string };
  loaded: DepartmentBudgetExport;
  exportedAt: Date;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "черновик",
  SUBMITTED: "на утверждении",
  APPROVED: "утверждена",
  RETURNED: "возвращена",
};

/**
 * Файл сметы цеха — один и тот же для «Экспорт Excel» и для диска проекта: смета по статьям
 * (утверждённая версия или черновик) с колонкой «Код» + «О выгрузке». Старая табличная версия —
 * её лист со значениями. Колонки — из конструктора (на диск — по умолчанию). Права, цех этого
 * проекта и разбор версии проверяет вызывающий; версия ищется только у этого цеха.
 */
export async function buildDepartmentBudgetFile(input: {
  projectId: string;
  departmentId: string;
  version: number | undefined;
  projectName: string;
  timezone: string | null;
  exportedBy: string;
  columns?: ExportColumn[];
}): Promise<DepartmentBudgetFile | { error: string }> {
  const { projectId, departmentId } = input;
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { name: true, codePrefix: true },
  });
  if (!department) return { error: "Цех не найден" };
  const loaded = await loadDepartmentBudgetExport(prisma, projectId, departmentId, input.version, (budgetId) =>
    loadItemsSnapshot(prisma, projectId, budgetId),
  );
  if ("error" in loaded) return { error: loaded.error };

  const exportedAt = new Date();
  const info = departmentExportInfo({
    projectName: input.projectName,
    departmentName: department.name,
    source: loaded.source,
    approved: loaded.approved,
    exportedBy: input.exportedBy,
    exportedAt,
    timezone: input.timezone,
  });
  let workbook: ExcelJS.Workbook;
  if (loaded.content.kind === "items") {
    workbook = new ExcelJS.Workbook();
    addItemsSheet(workbook, "Смета", loaded.content.snapshot, input.columns ?? smetaDefaultExportColumns());
    addExportInfoSheet(workbook, info);
  } else {
    workbook = buildDepartmentBudgetWorkbook(loaded.content.sheet, info);
  }
  const content = Buffer.from(await workbook.xlsx.writeBuffer());
  return { content, department, loaded, exportedAt };
}

export type SummaryBudgetFile = {
  content: Buffer;
  exportedAt: Date;
  /** Листов цехов в книге (без «Свода» и «О выгрузке»). */
  departmentSheets: number;
};

/**
 * Файл сводной — один и тот же для «Экспорт Excel» и для диска проекта: «Свод» (цеха, резерв,
 * агентские, итог — как на экране), лист на каждый цех (смета по статьям с кодами; старая
 * табличная версия — строками) и «О выгрузке». Права проверяет вызывающий.
 */
export async function buildSummaryBudgetFile(input: {
  projectId: string;
  access: SmetaAccessContext;
  drafts: boolean;
  projectName: string;
  timezone: string | null;
  exportedBy: string;
}): Promise<SummaryBudgetFile> {
  const { drafts } = input;
  const [{ summary, sources }, planFact] = await Promise.all([
    getItemsSummaryForExport(input.projectId, { drafts }),
    // Факт (начислено / оплачено) на дату выгрузки — за всё время, как в плане/факте.
    getPlanFact(input.projectId, input.access, { departmentId: null, dateFrom: null, dateTo: null }),
  ]);
  const factBy = new Map(planFact.departments.map((d) => [d.id, d.totals]));
  const workbook = new ExcelJS.Workbook();
  addSummarySheet(workbook, {
    rows: summary.departments.map((d) => ({
      name: d.name,
      note: drafts
        ? d.status
          ? `${STATUS_LABEL[d.status]}${d.incomplete > 0 ? `, без суммы: ${d.incomplete}` : ""}`
          : "сметы нет"
        : d.versionNumber
          ? `версия ${d.versionNumber}`
          : "нет утверждённой версии",
      ...d.totals,
      accrued: factBy.get(d.id)?.accrued ?? 0,
      paid: factBy.get(d.id)?.paid ?? 0,
    })),
    unassigned: planFact.unassigned ? { accrued: planFact.unassigned.accrued, paid: planFact.unassigned.paid } : null,
    subtotal: summary.subtotal,
    reserve: summary.reserve,
    agency: summary.agency,
    total: summary.total,
  });
  const taken = new Set(["свод"]);
  const columns = smetaDefaultExportColumns();
  let departmentSheets = 0;
  for (const source of sources) {
    if (source.kind === "items") addItemsSheet(workbook, source.name, source.snapshot, columns, taken);
    else if (source.kind === "sheet") {
      addSheetVersionLines(
        workbook,
        source.name,
        source.lines.map((l) => ({
          code: l.code,
          name: l.name,
          unit: l.unit,
          quantity: l.quantity == null ? null : Number(l.quantity),
          rate: l.rate == null ? null : Number(l.rate),
          taxPercent: l.taxPercent == null ? null : Number(l.taxPercent),
          amount: Number(l.amount),
          tax: Number(l.tax),
          total: Number(l.total),
        })),
        columns,
        taken,
      );
    } else continue;
    departmentSheets++;
  }
  const exportedAt = new Date();
  addExportInfoSheet(workbook, {
    document: "Сводная смета",
    project: input.projectName,
    status: summaryDriveModeLabel(drafts),
    version: null,
    approved: null,
    exportedBy: input.exportedBy,
    exportedAt: formatExportDateTime(exportedAt, input.timezone),
  });
  const content = Buffer.from(await workbook.xlsx.writeBuffer());
  return { content, exportedAt, departmentSheets };
}
