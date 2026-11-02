"use server";

import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";
import { DAY_NOT_FOUND, NO_RIGHTS } from "@/features/call-sheets/lib/template-rules";
import {
  canReadCallSheet,
  loadCallSheetPrintModel,
} from "@/features/call-sheets/print/load-print-model";
import { buildCallSheetWorkbook } from "@/features/call-sheets/print/print-xlsx";
import { formatApprovedAt } from "@/features/call-sheets/print/stamp";
import { getCallSheetStatus } from "@/features/call-sheets/queries";
import type { CloudConnectionView } from "@/features/cloud/components/cloud-file-picker";
import { listUserCloudConnections } from "@/features/cloud/lib/cloud-service";
import {
  callSheetDriveFileName,
  defaultDriveExportVersion,
  driveExportDoneText,
  DRIVE_STATUS_LABELS,
  parseDriveExportInput,
} from "@/features/cloud/lib/drive-export-rules";
import {
  listPersonalCallSheetExports,
  putCallSheetOnPersonalDrive,
  type DriveExportView,
} from "@/features/cloud/lib/drive-export-service";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { prisma } from "@/shared/db/prisma";

/**
 * «Экспорт → На диск» вызывного: выгрузка на личный Google / Яндекс Диск. Право —
 * «КПП и вызывные: просмотр», день — этого проекта (`assertInProject`), подключение — только
 * своё (из сессии). Из браузера — только провайдер и номер утверждённой версии.
 */

export type CallSheetDriveState = {
  /** null — вызывной ещё не создан (выгружается текущее состояние с меткой черновика). */
  sheet: { status: CallSheetStatusValue; version: number } | null;
  /** Выбор по умолчанию: утверждён — его версия; иначе null — текущая. */
  defaultVersion: number | null;
  versions: { version: number; label: string }[];
  connections: CloudConnectionView[];
  exports: DriveExportView[];
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

/** Окно выгрузки: версии, личные диски, что уже выгружено. Ничего не пишет. */
export async function getCallSheetDriveStateAction(
  projectId: string,
  dayId: string,
): Promise<CallSheetDriveState | { error: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!canReadCallSheet(ctx)) return { error: NO_RIGHTS };
  const id = await dayOfProject(projectId, dayId);
  if (!id) return { error: DAY_NOT_FOUND };
  const userId = ctx.user.id!;

  const [status, connections, exports] = await Promise.all([
    getCallSheetStatus(projectId, id),
    listUserCloudConnections(userId),
    listPersonalCallSheetExports(projectId, id, userId),
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
  };
}

export type CallSheetDriveExportResult =
  | { ok: true; message: string; export: DriveExportView }
  | { error: string; reconnect?: boolean };

const BUILD_FAILED = "Не удалось собрать Excel вызывного — попробуйте ещё раз";

/**
 * Выгрузить вызывной на свой личный диск. Повторная выгрузка заменяет тот же файл
 * (ссылка прежняя); удалённый руками файл или папка создаются заново — об этом в `message`.
 */
export async function exportCallSheetToDriveAction(
  projectId: string,
  dayId: string,
  input: unknown,
): Promise<CallSheetDriveExportResult> {
  const ctx = await requireProjectContext(projectId);
  if (!canReadCallSheet(ctx)) return { error: NO_RIGHTS };
  const parsed = parseDriveExportInput(input);
  if ("error" in parsed) return parsed;
  const id = await dayOfProject(projectId, dayId);
  if (!id) return { error: DAY_NOT_FOUND };

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

  const result = await putCallSheetOnPersonalDrive({
    userId: ctx.user.id!,
    projectId,
    dayId: id,
    dayNumber: day.dayNumber,
    provider: parsed.provider,
    projectName: ctx.project.name,
    fileName: callSheetDriveFileName(day, ctx.project.timezone, loaded.stamp),
    content,
    version: loaded.stamp.version,
    statusLabel: DRIVE_STATUS_LABELS[loaded.stamp.status],
  });
  if ("error" in result) return result;
  return {
    ok: true,
    message: driveExportDoneText(parsed.provider, result.outcome),
    export: result.view,
  };
}
