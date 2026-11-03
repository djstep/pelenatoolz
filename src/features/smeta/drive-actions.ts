"use server";

import {
  BUDGET_DRIVE_APPROVAL_NOTE,
  budgetDriveAudienceText,
  budgetDriveExportDoneText,
  budgetDriveFileName,
  budgetDriveKeeperHint,
  budgetDriveOutdatedText,
  budgetDriveStatusLabel,
  canExportBudgetToDrive,
  defaultBudgetDriveVersion,
  parseBudgetDriveRequest,
  summaryDriveFileName,
  summaryDriveSnapshotText,
  type BudgetStatusValue,
} from "@/features/cloud/lib/budget-drive-export-rules";
import { DRIVE_EXPORT_BAD_INPUT } from "@/features/cloud/lib/drive-export-rules";
import {
  getProjectBudgetExport,
  getProjectBudgetSummaryExport,
  getProjectDriveExportAvailability,
  hasProjectBudgetExports,
  putBudgetOnProjectDrive,
  putBudgetSummaryOnProjectDrive,
  type DriveExportView,
} from "@/features/cloud/lib/drive-export-service";
import {
  projectDriveUnavailableText,
  type ProjectDriveUnavailable,
} from "@/features/cloud/lib/project-drive-export-rules";
import { canSeeProjectDrive } from "@/features/cloud/lib/project-drive-rules";
import { projectDriveActor } from "@/features/cloud/lib/project-drive-service";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isProducerRole } from "@/features/roles/role-rules";
import { listDepartmentVersions } from "@/features/smeta/approval-queries";
import { buildDepartmentBudgetFile, buildSummaryBudgetFile } from "@/features/smeta/export-file";
import { departmentExportLabel } from "@/features/smeta/lib/export-department-xlsx";
import { formatExportDateTime } from "@/features/smeta/lib/export-info-sheet";
import { auditMemberName } from "@/shared/audit/member-name";
import { prisma } from "@/shared/db/prisma";

/**
 * «На диск…» сметы цеха (`docs/tasks/BUDGET_DRIVE_NOTES.md`, п. 3, решение 8): только диск
 * проекта, папка «Сметы / Цеха / <Цех>»; выгружают продюсеры и главы этого цеха (без условия
 * финансов). Из браузера — только `parseBudgetDriveRequest` (цех, номер версии).
 * Сводная — «Сметы / Сводная», выгружают только продюсеры; из браузера — только режим.
 */

const NO_RIGHTS = "Недостаточно прав";
const DEPARTMENT_NOT_FOUND = "Цех не найден";
const BUILD_FAILED = "Не удалось собрать Excel сметы — попробуйте ещё раз";
const BUILD_SUMMARY_FAILED = "Не удалось собрать сводную — попробуйте ещё раз";
const SUMMARY = { kind: "summary" } as const;

type ProjectCtx = Awaited<ReturnType<typeof requireProjectContext>>;

function budgetActor(ctx: ProjectCtx) {
  return { isProducer: isProducerRole(ctx.role), headDepartmentIds: ctx.headDepartmentIds };
}

async function departmentOfProject(projectId: string, departmentId: unknown): Promise<string | null> {
  if (typeof departmentId !== "string" || departmentId.trim() === "" || departmentId.length > 100) return null;
  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (e) {
    if (isNotInProjectError(e)) return null;
    throw e;
  }
  return departmentId;
}

export type BudgetDriveState = {
  departmentName: string;
  status: BudgetStatusValue;
  latestVersion: number | null;
  /** Выбор по умолчанию: утверждена — последняя утверждённая; иначе null — текущий лист. */
  defaultVersion: number | null;
  versions: { version: number; label: string }[];
  audience: string;
  approvalNote: string;
  existing: DriveExportView | null;
  /** «На диске — версия 2, утверждена версия 3». */
  outdated: string | null;
  /** До первой выгрузки смет в проект — про служебный аккаунт компании. */
  keeperHint: string | null;
  /** Диск проекта недоступен — почему (кнопки «Выгрузить» нет). */
  unavailable: string | null;
};

/** Окно «На диск…»: версии, кто увидит, что уже на диске. Ничего не пишет. */
export async function getBudgetDriveStateAction(
  projectId: string,
  departmentId: string,
): Promise<BudgetDriveState | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  const id = await departmentOfProject(projectId, departmentId);
  if (!id) return { error: DEPARTMENT_NOT_FOUND };
  if (!canExportBudgetToDrive(budgetActor(ctx), { kind: "department", departmentId: id })) {
    return { error: NO_RIGHTS };
  }
  const [department, budget, versions, availability, existing, hadExports, drive] = await Promise.all([
    prisma.department.findFirstOrThrow({ where: { id, projectId }, select: { name: true } }),
    prisma.budget.findFirst({ where: { projectId, departmentId: id }, select: { status: true } }),
    listDepartmentVersions(projectId, id),
    getProjectDriveExportAvailability(projectId),
    getProjectBudgetExport(projectId, id),
    hasProjectBudgetExports(projectId),
    prisma.projectDrive.findUnique({ where: { projectId }, select: { accountEmail: true } }),
  ]);
  if (!budget) return { error: "Смета ещё не создана" };
  const latestVersion = versions[0]?.number ?? null;
  return {
    departmentName: department.name,
    status: budget.status,
    latestVersion,
    defaultVersion: defaultBudgetDriveVersion({ status: budget.status, latestVersion }),
    versions: versions.map((v) => ({
      version: v.number,
      label: `Версия ${v.number} · утверждена ${formatExportDateTime(new Date(v.approvedAt), ctx.project.timezone)} · ${v.approvedByName}`,
    })),
    audience: budgetDriveAudienceText({ kind: "department", departmentId: id }, department.name),
    approvalNote: BUDGET_DRIVE_APPROVAL_NOTE,
    existing: availability ? null : existing,
    outdated: availability ? null : budgetDriveOutdatedText(existing, latestVersion),
    keeperHint: !availability && !hadExports ? budgetDriveKeeperHint(drive?.accountEmail ?? null) : null,
    unavailable: availability
      ? projectDriveUnavailableText(availability, canSeeProjectDrive(projectDriveActor(ctx)))
      : null,
  };
}

export type BudgetDriveExportResult =
  | { ok: true; message: string; export: DriveExportView; outdated: string | null }
  | { error: string; projectDrive?: ProjectDriveUnavailable };

/**
 * Выгрузить смету цеха на диск проекта: вход и проект → разбор ввода → цех этого проекта → право
 * (продюсер или глава этого цеха) → смета есть, версия этого цеха → файл → диск годен (под
 * блокировкой). Повторная выгрузка заменяет тот же файл; доступы папки — после ответа.
 */
export async function exportBudgetToDriveAction(
  projectId: string,
  input: unknown,
): Promise<BudgetDriveExportResult> {
  const ctx = await requireProjectContext(projectId);
  const parsed = parseBudgetDriveRequest(input);
  if ("error" in parsed) return parsed;
  // Сводная — отдельным шагом (со страницы сводной).
  if ("drafts" in parsed) return { error: NO_RIGHTS };
  const id = await departmentOfProject(projectId, parsed.target.departmentId);
  if (!id) return { error: DEPARTMENT_NOT_FOUND };
  if (!canExportBudgetToDrive(budgetActor(ctx), { kind: "department", departmentId: id })) {
    return { error: NO_RIGHTS };
  }

  let file: Awaited<ReturnType<typeof buildDepartmentBudgetFile>>;
  try {
    file = await buildDepartmentBudgetFile({
      projectId,
      departmentId: id,
      version: parsed.version,
      projectName: ctx.project.name,
      timezone: ctx.project.timezone,
      exportedBy: auditMemberName(ctx.user.name),
    });
  } catch (e) {
    console.error("[budget drive] сборка Excel", e);
    return { error: BUILD_FAILED };
  }
  if ("error" in file) return { error: file.error };
  const { loaded } = file;

  const result = await putBudgetOnProjectDrive({
    userId: ctx.user.id!,
    projectId,
    departmentId: id,
    projectName: ctx.project.name,
    fileName: budgetDriveFileName(file.department.name, loaded.source, file.exportedAt, ctx.project.timezone),
    content: file.content,
    version: loaded.source.kind === "version" ? loaded.source.number : null,
    statusLabel: budgetDriveStatusLabel(loaded.source),
    label: departmentExportLabel(loaded.source),
  });
  if ("unavailable" in result) {
    return {
      error: projectDriveUnavailableText(result.unavailable, canSeeProjectDrive(projectDriveActor(ctx))),
      projectDrive: result.unavailable,
    };
  }
  if ("error" in result) return result;
  const latest = await prisma.budgetVersion.findFirst({
    where: { projectId, departmentId: id },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return {
    ok: true,
    message: budgetDriveExportDoneText({ kind: "department", departmentId: id }, result.outcome, result.placeLabel),
    export: result.view,
    outdated: budgetDriveOutdatedText(result.view, latest?.number ?? null),
  };
}

// ---------- сводная (шаг 5) ----------

export type BudgetSummaryDriveState = {
  audience: string;
  approvalNote: string;
  /** «Снимок на 03.11.2026: в «Своде» — факт на дату выгрузки…». */
  snapshot: string;
  existing: DriveExportView | null;
  keeperHint: string | null;
  unavailable: string | null;
};

/** Окно «На диск…» сводной: только продюсеру. Ничего не пишет. */
export async function getBudgetSummaryDriveStateAction(
  projectId: string,
): Promise<BudgetSummaryDriveState | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!canExportBudgetToDrive(budgetActor(ctx), SUMMARY)) return { error: NO_RIGHTS };
  const [availability, existing, hadExports, drive] = await Promise.all([
    getProjectDriveExportAvailability(projectId),
    getProjectBudgetSummaryExport(projectId),
    hasProjectBudgetExports(projectId),
    prisma.projectDrive.findUnique({ where: { projectId }, select: { accountEmail: true } }),
  ]);
  return {
    audience: budgetDriveAudienceText(SUMMARY, null),
    approvalNote: BUDGET_DRIVE_APPROVAL_NOTE,
    snapshot: summaryDriveSnapshotText(new Date(), ctx.project.timezone),
    existing: availability ? null : existing,
    keeperHint: !availability && !hadExports ? budgetDriveKeeperHint(drive?.accountEmail ?? null) : null,
    unavailable: availability
      ? projectDriveUnavailableText(availability, canSeeProjectDrive(projectDriveActor(ctx)))
      : null,
  };
}

export type BudgetSummaryDriveExportResult =
  | { ok: true; message: string; export: DriveExportView }
  | { error: string; projectDrive?: ProjectDriveUnavailable };

/**
 * Выгрузить сводную на диск проекта («Сметы / Сводная»): вход и проект → разбор ввода (только
 * «сводная» и режим) → только продюсер → книга (та же, что «Экспорт Excel») → диск годен (под
 * блокировкой). Один файл на проект, повторная — замена; доступы папки — после ответа.
 */
export async function exportBudgetSummaryToDriveAction(
  projectId: string,
  input: unknown,
): Promise<BudgetSummaryDriveExportResult> {
  const ctx = await requireProjectContext(projectId);
  const parsed = parseBudgetDriveRequest(input);
  if ("error" in parsed) return parsed;
  // Смета цеха — со страницы сметы цеха.
  if (!("drafts" in parsed)) return { error: DRIVE_EXPORT_BAD_INPUT };
  if (!canExportBudgetToDrive(budgetActor(ctx), SUMMARY)) return { error: NO_RIGHTS };

  let file: Awaited<ReturnType<typeof buildSummaryBudgetFile>>;
  try {
    file = await buildSummaryBudgetFile({
      projectId,
      access: ctx,
      drafts: parsed.drafts,
      projectName: ctx.project.name,
      timezone: ctx.project.timezone,
      exportedBy: auditMemberName(ctx.user.name),
    });
  } catch (e) {
    console.error("[budget drive] сборка сводной", e);
    return { error: BUILD_SUMMARY_FAILED };
  }

  const result = await putBudgetSummaryOnProjectDrive({
    userId: ctx.user.id!,
    projectId,
    projectName: ctx.project.name,
    fileName: summaryDriveFileName(parsed.drafts, file.exportedAt, ctx.project.timezone),
    content: file.content,
    drafts: parsed.drafts,
  });
  if ("unavailable" in result) {
    return {
      error: projectDriveUnavailableText(result.unavailable, canSeeProjectDrive(projectDriveActor(ctx))),
      projectDrive: result.unavailable,
    };
  }
  if ("error" in result) return result;
  return {
    ok: true,
    message: budgetDriveExportDoneText(SUMMARY, result.outcome, result.placeLabel),
    export: result.view,
  };
}
