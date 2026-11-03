import "server-only";

import { summaryDriveModeLabel } from "@/features/cloud/lib/budget-drive-export-rules";
import { loadDepartmentBudgetExport, type DepartmentBudgetExport } from "@/features/smeta/export-queries";
import {
  buildDepartmentBudgetWorkbook,
  departmentExportInfo,
} from "@/features/smeta/lib/export-department-xlsx";
import { addExportInfoSheet, formatExportDateTime } from "@/features/smeta/lib/export-info-sheet";
import { buildSummaryWorkbook } from "@/features/smeta/lib/export-summary-xlsx";
import type { SmetaAccessContext } from "@/features/smeta/lib/smeta-access";
import { getSummaryBook } from "@/features/smeta/summary-queries";
import { prisma } from "@/shared/db/prisma";

export type DepartmentBudgetFile = {
  content: Buffer;
  department: { name: string; codePrefix: string };
  loaded: DepartmentBudgetExport;
  exportedAt: Date;
};

/**
 * Файл сметы цеха — один и тот же для «Экспорт Excel» и для диска проекта: основной лист
 * (утверждённая версия или текущий лист) + «О выгрузке». Права, цех этого проекта и разбор версии
 * проверяет вызывающий; версия ищется только у этого цеха.
 */
export async function buildDepartmentBudgetFile(input: {
  projectId: string;
  departmentId: string;
  version: number | undefined;
  projectName: string;
  timezone: string | null;
  exportedBy: string;
}): Promise<DepartmentBudgetFile | { error: string }> {
  const { projectId, departmentId } = input;
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { name: true, codePrefix: true },
  });
  if (!department) return { error: "Цех не найден" };
  const loaded = await loadDepartmentBudgetExport(prisma, projectId, departmentId, input.version);
  if ("error" in loaded) return { error: loaded.error };

  const exportedAt = new Date();
  const workbook = buildDepartmentBudgetWorkbook(
    loaded.sheet,
    departmentExportInfo({
      projectName: input.projectName,
      departmentName: department.name,
      source: loaded.source,
      approved: loaded.approved,
      exportedBy: input.exportedBy,
      exportedAt,
      timezone: input.timezone,
    }),
  );
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
 * Файл сводной — один и тот же для «Экспорт Excel» и для диска проекта: «Свод» (факт на дату
 * выгрузки), лист на каждый цех (утверждённые версии или черновики) и «О выгрузке». Права
 * проверяет вызывающий.
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
  const book = await getSummaryBook(input.projectId, input.access, { drafts });
  const exportedAt = new Date();
  const workbook = buildSummaryWorkbook(book.workbook);
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
  return { content, exportedAt, departmentSheets: book.rows.length };
}
