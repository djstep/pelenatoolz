"use server";

import { buildCrewPrintHtml } from "@/features/crew/lib/crew-export-print";
import { crewExportColumns, crewExportGroups } from "@/features/crew/lib/crew-export";
import { buildCrewWorkbook } from "@/features/crew/lib/crew-export-xlsx";
import { crewRights } from "@/features/crew/lib/crew-rules";
import { listCrew, listCrewDepartments } from "@/features/crew/queries";
import { crewExportSchema } from "@/features/crew/schemas";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { formatFileDate } from "@/shared/i18n/format-date";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type CrewExportResult =
  | { error: string }
  | { html: string }
  | { base64: string; fileName: string; mime: string };

/**
 * Excel и печать. Права решаются здесь: из запроса берётся только порядок и заголовки колонок,
 * поля без права отбрасывает `crewExportColumns`, а данные собирает `toCrewRow`.
 */
export async function exportCrewAction(projectId: string, input: unknown): Promise<CrewExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("crew:read")) return { error: "Недостаточно прав" };

  const parsed = crewExportSchema.safeParse(input);
  if (!parsed.success) return { error: "Проверьте столбцы" };

  const rights = crewRights(ctx.can);
  const columns = crewExportColumns(parsed.data.columns, rights);
  if (columns.length === 0) return { error: "Добавьте хотя бы один столбец" };

  const [rows, departments] = await Promise.all([
    listCrew(projectId, rights),
    listCrewDepartments(projectId),
  ]);
  const groups = crewExportGroups(rows, departments, parsed.data.includeArchived ?? false);
  if (groups.length === 0) return { error: "В списке никого нет" };

  if (parsed.data.format === "pdf") {
    return { html: buildCrewPrintHtml(ctx.project.name, columns, groups) };
  }
  const buffer = await buildCrewWorkbook(columns, groups);
  return {
    base64: buffer.toString("base64"),
    fileName: `Команда · ${formatFileDate(new Date(), ctx.project.timezone)}.xlsx`,
    mime: XLSX_MIME,
  };
}
