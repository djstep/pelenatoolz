"use server";

import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import {
  canEditCallSheets,
  DAY_NOT_FOUND,
  DEPARTMENT_NOT_FOUND,
  NO_RIGHTS,
} from "@/features/call-sheets/lib/template-rules";
import {
  canReadCallSheet,
  loadCallSheetPrintModel,
} from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetWorkbook } from "@/features/call-sheets/print/print-xlsx";
import { formatApprovedAt } from "@/features/call-sheets/print/stamp";
import { getCallSheetStatus } from "@/features/call-sheets/queries";
import type { CloudConnectionView } from "@/features/cloud/components/cloud-file-picker";
import { listUserCloudConnections } from "@/features/cloud/lib/cloud-service";
import { departmentFolderKey, PROJECT_FOLDER_KEYS } from "@/features/cloud/lib/drive-access-rules";
import {
  callSheetDriveFileName,
  defaultDriveExportVersion,
  driveExportDoneText,
  DRIVE_STATUS_LABELS,
  parseDriveExportRequest,
} from "@/features/cloud/lib/drive-export-rules";
import {
  getProjectDriveExportAvailability,
  listPersonalCallSheetExports,
  listProjectCallSheetExports,
  putCallSheetOnPersonalDrive,
  putCallSheetOnProjectDrive,
  type DriveExportView,
  type ProjectDriveExportView,
} from "@/features/cloud/lib/drive-export-service";
import {
  canExportToDestination,
  departmentsForExport,
  driveDestinationAccess,
  hasProjectDriveDestinations,
  projectDriveAudienceText,
  projectDriveExportDoneText,
  projectDriveUnavailableText,
  type DriveExportActor,
  type ProjectDriveUnavailable,
} from "@/features/cloud/lib/project-drive-export-rules";
import { canSeeProjectDrive } from "@/features/cloud/lib/project-drive-rules";
import { projectDriveActor } from "@/features/cloud/lib/project-drive-service";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isProducerRole } from "@/features/roles/role-rules";
import { prisma } from "@/shared/db/prisma";

/**
 * «Экспорт → На диск» вызывного (`docs/tasks/WAVE_3_DRIVE_NOTES.md`, п. 5):
 *   - личный Google / Яндекс Диск — «КПП и вызывные: просмотр», подключение — только своё (из сессии);
 *   - диск проекта, «Общая» — «КПП и вызывные: правка»;
 *   - диск проекта, папка цеха — главы этого цеха (с просмотром вызывных) и продюсеры.
 * День и цех — этого проекта (`assertInProject`). Из браузера — только id дня, назначение, id цеха,
 * провайдер (для личного) и номер утверждённой версии.
 */

/** Диск проекта в окне выгрузки: что доступно этому человеку. */
export type CallSheetProjectDriveState = {
  /** null — можно выгружать; иначе диск недоступен, `notice` — почему. */
  unavailable: ProjectDriveUnavailable | null;
  notice: string | null;
  /** Продюсеры и владелец — ссылка в настройки проекта (раздел «Диск проекта»). */
  canOpenSettings: boolean;
  common: { audience: string } | null;
  departments: { id: string; name: string; audience: string }[];
};

export type CallSheetDriveState = {
  /** null — вызывной ещё не создан (выгружается текущее состояние с меткой черновика). */
  sheet: { status: CallSheetStatusValue; version: number } | null;
  /** Выбор по умолчанию: утверждён — его версия; иначе null — текущая. */
  defaultVersion: number | null;
  versions: { version: number; label: string }[];
  connections: CloudConnectionView[];
  exports: DriveExportView[];
  /** null — назначений на диске проекта у человека нет (раздел не показывается). */
  projectDrive: CallSheetProjectDriveState | null;
  /** Уже на диске проекта — только в назначения, доступные человеку. */
  projectExports: ProjectDriveExportView[];
};

async function dayOfProject(projectId: string, dayId: unknown): Promise<string | null> {
  if (typeof dayId !== "string" || dayId.trim() === "" || dayId.length > 100) return null;
  try {
    await assertInProject("ShootDay", dayId, projectId);
  } catch (e) {
    if (isNotInProjectError(e)) return null;
    throw e;
  }
  return dayId;
}

async function departmentOfProject(projectId: string, departmentId: string): Promise<boolean> {
  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (e) {
    if (isNotInProjectError(e)) return false;
    throw e;
  }
  return true;
}

type ProjectCtx = Awaited<ReturnType<typeof requireProjectContext>>;

/** Кто выгружает — из проверенного контекста (роль, главенство в цехах текущего участия). */
function exportActor(ctx: ProjectCtx): DriveExportActor {
  return {
    canReadCallSheets: canReadCallSheet(ctx),
    canEditCallSheets: canEditCallSheets(ctx),
    isProducer: isProducerRole(ctx.role),
    headDepartmentIds: ctx.headDepartmentIds,
  };
}

/** Окно выгрузки: версии, личные диски, назначения диска проекта, что уже выгружено. Ничего не пишет. */
export async function getCallSheetDriveStateAction(
  projectId: string,
  dayId: string,
): Promise<CallSheetDriveState | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!canReadCallSheet(ctx)) return { error: NO_RIGHTS };
  const id = await dayOfProject(projectId, dayId);
  if (!id) return { error: DAY_NOT_FOUND };
  const userId = ctx.user.id!;
  const access = driveDestinationAccess(exportActor(ctx));

  const [status, connections, exports, projectDepartments, availability, projectExports] = await Promise.all([
    getCallSheetStatus(projectId, id),
    listUserCloudConnections(userId),
    listPersonalCallSheetExports(projectId, id, userId),
    prisma.department.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    getProjectDriveExportAvailability(projectId),
    listProjectCallSheetExports(projectId, id),
  ]);
  const departments = departmentsForExport(access, projectDepartments);
  const canOpenSettings = canSeeProjectDrive(projectDriveActor(ctx));
  const projectDrive: CallSheetProjectDriveState | null = hasProjectDriveDestinations(access, departments.length)
    ? {
        unavailable: availability,
        notice: availability ? projectDriveUnavailableText(availability, canOpenSettings) : null,
        canOpenSettings,
        common: access.common ? { audience: projectDriveAudienceText("common", null) } : null,
        departments: departments.map((d) => ({
          ...d,
          audience: projectDriveAudienceText("department", d.name),
        })),
      }
    : null;
  const visibleKeys = new Set<string>([
    ...(access.common ? [PROJECT_FOLDER_KEYS.common] : []),
    ...departments.map((d) => departmentFolderKey(d.id)),
  ]);

  const sheet = status ? { status: status.status, version: status.version } : null;
  return {
    sheet,
    defaultVersion: defaultDriveExportVersion(sheet),
    versions: (status?.versions ?? []).map((v) => ({
      version: v.version,
      label: [
        `Версия ${v.version} · утверждён ${formatApprovedAt(v.approvedAt, ctx.project.timezone)}`,
        v.approvedByName,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    connections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      accountEmail: c.accountEmail,
      accountLabel: c.accountLabel,
      reconnectReason: c.reconnectReason,
    })),
    exports,
    projectDrive,
    projectExports: projectExports.filter((e) => visibleKeys.has(e.key)),
  };
}

export type CallSheetDriveExportResult =
  | { ok: true; message: string; export: DriveExportView; projectKey?: string }
  | { error: string; reconnect?: boolean; projectDrive?: ProjectDriveUnavailable };

const BUILD_FAILED = "Не удалось собрать Excel вызывного — попробуйте ещё раз";

/**
 * Выгрузить вызывной: на свой личный диск, в «Общую» или папку цеха на диске проекта. Права —
 * по назначению (`canExportToDestination`), день и цех — этого проекта (`assertInProject`).
 * Повторная выгрузка в ту же папку заменяет тот же файл (ссылка прежняя); удалённый руками файл
 * или папка создаются заново — об этом в `message`.
 */
export async function exportCallSheetToDriveAction(
  projectId: string,
  dayId: string,
  input: unknown,
): Promise<CallSheetDriveExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (!canReadCallSheet(ctx)) return { error: NO_RIGHTS };
  const parsed = parseDriveExportRequest(input);
  if ("error" in parsed) return parsed;
  const { destination } = parsed;
  const id = await dayOfProject(projectId, dayId);
  if (!id) return { error: DAY_NOT_FOUND };
  if (destination.kind === "department" && !(await departmentOfProject(projectId, destination.departmentId))) {
    return { error: DEPARTMENT_NOT_FOUND };
  }
  if (!canExportToDestination(exportActor(ctx), destination)) return { error: NO_RIGHTS };

  // Тот же лист, что в печати и Excel: утверждённый — снимок, иначе живые данные с меткой.
  const loaded = await loadCallSheetPrintModel(projectId, id, parsed.version);
  if ("error" in loaded) return { error: loaded.error };

  const day = await prisma.shootDay.findFirst({
    where: { id, projectId },
    select: { dayNumber: true, date: true },
  });
  if (!day) return { error: DAY_NOT_FOUND };

  let content: Buffer;
  try {
    const workbook = buildCallSheetWorkbook(loaded.model, loaded.stamp);
    content = Buffer.from(await workbook.xlsx.writeBuffer());
  } catch (e) {
    console.error("[drive export] сборка Excel", e);
    return { error: BUILD_FAILED };
  }

  const base = {
    userId: ctx.user.id!,
    projectId,
    dayId: id,
    dayNumber: day.dayNumber,
    projectName: ctx.project.name,
    fileName: callSheetDriveFileName(day, ctx.project.timezone, loaded.stamp),
    content,
    version: loaded.stamp.version,
    statusLabel: DRIVE_STATUS_LABELS[loaded.stamp.status],
  };

  if (destination.kind === "personal") {
    const result = await putCallSheetOnPersonalDrive({ ...base, provider: destination.provider });
    if ("error" in result) return result;
    return {
      ok: true,
      message: driveExportDoneText(destination.provider, result.outcome),
      export: result.view,
    };
  }

  const result = await putCallSheetOnProjectDrive({
    ...base,
    target:
      destination.kind === "common"
        ? { kind: "common" }
        : { kind: "department", departmentId: destination.departmentId },
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
    message: projectDriveExportDoneText(result.outcome, result.placeLabel),
    export: result.view,
    projectKey:
      destination.kind === "common" ? PROJECT_FOLDER_KEYS.common : departmentFolderKey(destination.departmentId),
  };
}
