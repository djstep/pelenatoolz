"use server";

import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { buildDepartmentBudgetFile, buildSummaryBudgetFile } from "@/features/smeta/export-file";
import {
  departmentExportFileName,
  departmentExportLabel,
  parseDepartmentExportVersion,
  summaryExportFileName,
} from "@/features/smeta/lib/export-department-xlsx";
import {
  buildPlanFactWorkbook,
  workbookToBase64,
} from "@/features/smeta/lib/export-plan-fact-xlsx";
import { planFactPeriodLabel } from "@/features/smeta/lib/plan-fact";
import {
  canOpenSmeta,
  canReadAllSmeta,
  canReadDepartmentSmeta,
} from "@/features/smeta/lib/smeta-access";
import { getPlanFact, resolvePlanFactFilters } from "@/features/smeta/plan-fact-queries";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMemberName } from "@/shared/audit/member-name";
import { recordAudit } from "@/shared/audit/with-audit";
import { formatFileDate } from "@/shared/i18n/format-date";

const NO_RIGHTS = "Недостаточно прав";
/** Больше — не отдаём: ответ серверного действия целиком в памяти браузера. */
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

export type SmetaExportResult =
  | { error: string; base64?: undefined; fileName?: undefined }
  | { error?: undefined; base64: string; fileName: string };

function stamp(timezone: string | null) {
  return formatFileDate(new Date(), timezone);
}

/** План/факт в Excel. Те же права и фильтры, что у экрана; выгрузка — в журнал, без сумм. */
export async function exportPlanFactAction(
  projectId: string,
  payload: unknown,
): Promise<SmetaExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (!canOpenSmeta(ctx)) return { error: NO_RIGHTS };

  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const filters = await resolvePlanFactFilters(projectId, ctx, raw);
  if (!filters) return { error: "Цех не найден" };

  const report = await getPlanFact(projectId, ctx, filters);
  const departmentLabel = filters.departmentId
    ? (report.departments[0]?.name ?? "—")
    : "все доступные";
  const periodLabel = planFactPeriodLabel(filters.dateFrom, filters.dateTo);
  const base64 = await workbookToBase64(
    buildPlanFactWorkbook(report, {
      projectName: ctx.project.name,
      periodLabel,
      departmentLabel,
    }),
  );
  if (base64.length * 0.75 > MAX_EXPORT_BYTES) {
    return { error: "Выгрузка слишком большая — сузьте период или выберите цех" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.smetaExport,
    entityId: filters.departmentId ?? projectId,
    action: "CREATE",
    summary: `Выгрузка плана/факта в Excel: цех — ${
      filters.departmentId ? `«${departmentLabel}»` : "все доступные"
    }, период — ${periodLabel}`,
    changes: {
      export: "plan_fact",
      departmentId: filters.departmentId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    },
  });
  return { base64, fileName: `plan-fact-${stamp(ctx.project.timezone)}.xlsx` };
}

/** Сводная книга в Excel: продюсер и «Сметы — просмотр всех». Выгрузка — в журнал. */
export async function exportSummaryBookAction(
  projectId: string,
  payload: unknown,
): Promise<SmetaExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (!canReadAllSmeta(ctx)) return { error: NO_RIGHTS };

  const drafts = Boolean(
    payload && typeof payload === "object" && (payload as { drafts?: unknown }).drafts === true,
  );
  // Тот же файл, что уходит на диск проекта.
  const file = await buildSummaryBudgetFile({
    projectId,
    access: ctx,
    drafts,
    projectName: ctx.project.name,
    timezone: ctx.project.timezone,
    exportedBy: auditMemberName(ctx.user.name),
  });
  if (file.content.length > MAX_EXPORT_BYTES) {
    return { error: "Выгрузка слишком большая" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.smetaExport,
    entityId: projectId,
    action: "CREATE",
    summary: `Выгрузка сводной книги в Excel: все цеха, ${
      drafts ? "черновики" : "утверждённые версии"
    }`,
    changes: { export: "summary_book", drafts },
  });
  return {
    base64: file.content.toString("base64"),
    fileName: summaryExportFileName(drafts, file.exportedAt, ctx.project.timezone),
  };
}

/**
 * Смета цеха в Excel: основной лист (утверждённая версия или текущий лист со значениями вместо
 * формул) + «О выгрузке». Права — как у просмотра сметы цеха (глава этого цеха, продюсер,
 * «Сметы — просмотр всех»). Из браузера — только id цеха и номер версии. Журнал — без сумм.
 */
export async function exportDepartmentBudgetAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
): Promise<SmetaExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (typeof departmentId !== "string" || !departmentId) return { error: "Цех не найден" };
  // Нет права на смету этого цеха — отказ до поиска цеха (как у страницы).
  if (!canReadDepartmentSmeta(ctx, departmentId)) return { error: NO_RIGHTS };
  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Цех не найден" };
    throw error;
  }
  const version = parseDepartmentExportVersion(payload);
  if (version === false) return { error: "Некорректные данные" };

  // Тот же файл, что уходит на диск проекта.
  const file = await buildDepartmentBudgetFile({
    projectId,
    departmentId,
    version,
    projectName: ctx.project.name,
    timezone: ctx.project.timezone,
    exportedBy: auditMemberName(ctx.user.name),
  });
  if ("error" in file) return { error: file.error };
  const { department, loaded } = file;
  if (file.content.length > MAX_EXPORT_BYTES) {
    return { error: "Выгрузка слишком большая" };
  }

  const label = departmentExportLabel(loaded.source);
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.smetaExport,
    entityId: departmentId,
    action: "CREATE",
    summary: `Выгрузка сметы цеха «${department.name}» в Excel: ${label}`,
    changes: {
      export: "department",
      departmentId,
      version: loaded.source.kind === "version" ? loaded.source.number : null,
      status: loaded.status,
    },
  });
  return {
    base64: file.content.toString("base64"),
    fileName: departmentExportFileName(department.name, loaded.source, file.exportedAt, ctx.project.timezone),
  };
}
