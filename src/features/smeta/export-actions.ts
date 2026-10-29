"use server";

import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  buildPlanFactWorkbook,
  workbookToBase64,
} from "@/features/smeta/lib/export-plan-fact-xlsx";
import { buildSummaryWorkbook } from "@/features/smeta/lib/export-summary-xlsx";
import { planFactPeriodLabel } from "@/features/smeta/lib/plan-fact";
import { canOpenSmeta, canReadAllSmeta } from "@/features/smeta/lib/smeta-access";
import { getPlanFact, resolvePlanFactFilters } from "@/features/smeta/plan-fact-queries";
import { getSummaryBook } from "@/features/smeta/summary-queries";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

const NO_RIGHTS = "Недостаточно прав";
/** Больше — не отдаём: ответ серверного действия целиком в памяти браузера. */
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

export type SmetaExportResult =
  | { error: string; base64?: undefined; fileName?: undefined }
  | { error?: undefined; base64: string; fileName: string };

function stamp() {
  return new Date().toISOString().slice(0, 10);
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
  return { base64, fileName: `plan-fact-${stamp()}.xlsx` };
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
  const book = await getSummaryBook(projectId, ctx, { drafts });
  const base64 = await workbookToBase64(buildSummaryWorkbook(book.workbook));
  if (base64.length * 0.75 > MAX_EXPORT_BYTES) {
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
  return { base64, fileName: `summary-book-${stamp()}.xlsx` };
}
