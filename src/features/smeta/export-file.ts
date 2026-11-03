import "server-only";

import { loadDepartmentBudgetExport, type DepartmentBudgetExport } from "@/features/smeta/export-queries";
import {
  buildDepartmentBudgetWorkbook,
  departmentExportInfo,
} from "@/features/smeta/lib/export-department-xlsx";
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
