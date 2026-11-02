"use server";

import { revalidatePath } from "next/cache";
import type { CloudActionState } from "@/features/cloud/actions";
import {
  driveSyncResultText,
  syncProjectDriveAccess,
  type DriveSyncResult,
} from "@/features/cloud/lib/drive-access-sync";
import { isCloudApiError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import { assertInProject, isNotInProjectError } from "@/features/memberships/assert-in-project";
import { prisma } from "@/shared/db/prisma";
import { canSeeProjectDrive } from "@/features/cloud/lib/project-drive-rules";
import {
  disconnectProjectDrive,
  getProjectDriveAccessToken,
  projectDriveActor,
  revokeProjectDriveTokens,
} from "@/features/cloud/lib/project-drive-service";
import { requireProjectContext } from "@/features/projects/lib/project-context";

function revalidateProjectDrive(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/settings`);
  revalidatePath(`/ru/projects/${projectId}`, "layout");
}

/** Отключить диск проекта — хранитель или владелец (проверка — под блокировкой проекта). */
export async function disconnectProjectDriveAction(projectId: string): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  const result = await disconnectProjectDrive(projectId, ctx.user.id!);
  if ("error" in result) return { error: result.error };
  // Отзыв у Google — после транзакции; аккаунт ещё подключён в системе — не отзываем.
  const outcome = await revokeProjectDriveTokens(result.released);
  revalidateProjectDrive(projectId);
  return {
    success:
      outcome === "shared"
        ? "Диск проекта отключён. Доступ у Google не отозван: этот аккаунт ещё подключён в системе"
        : outcome === "failed"
          ? "Диск проекта отключён. Отозвать доступ у Google не удалось — уберите приложение в настройках аккаунта"
          : "Диск проекта отключён",
  };
}

/** Проверить доступ к диску проекта (обновить токен у Google) — владелец и продюсеры. */
export async function checkProjectDriveAction(projectId: string): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!canSeeProjectDrive(projectDriveActor(ctx))) return { error: "Недостаточно прав" };
  try {
    await getProjectDriveAccessToken(projectId, ctx.user.id!, { forceRefresh: true });
    return { success: "Доступ к диску проекта есть" };
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) {
      revalidateProjectDrive(projectId);
      return { error: "Доступ к диску проекта отозван или истёк — нужно переподключить" };
    }
    if (isCloudApiError(e)) return { error: e.message };
    console.error("[project drive check]", e instanceof Error ? e.message : e);
    return { error: "Не удалось проверить диск проекта — обновите страницу и попробуйте ещё раз" };
  }
}

function syncState(result: DriveSyncResult): CloudActionState {
  const { ok, text } = driveSyncResultText(result);
  return ok ? { success: text } : { error: text };
}

/**
 * «Синхронизировать доступы» — владелец и продюсеры. Пересчёт идёт сразу (человек ждёт итог);
 * ошибки Google остаются строками «не синхронизировано».
 */
export async function syncProjectDriveAccessAction(projectId: string): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!canSeeProjectDrive(projectDriveActor(ctx))) return { error: "Недостаточно прав" };
  const result = await syncProjectDriveAccess(projectId, { actorUserId: ctx.user.id!, trigger: "manual" });
  revalidateProjectDrive(projectId);
  return syncState(result);
}

/** «Повторить» у строки «не синхронизировано» — пересчёт папки этой строки. Владелец и продюсеры. */
export async function retryProjectDriveGrantAction(
  projectId: string,
  grantId: string,
): Promise<CloudActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!canSeeProjectDrive(projectDriveActor(ctx))) return { error: "Недостаточно прав" };
  if (typeof grantId !== "string" || !grantId) return { error: "Запись не найдена" };
  try {
    await assertInProject("DriveFolderGrant", grantId, projectId);
  } catch (e) {
    if (isNotInProjectError(e)) return { error: "Запись не найдена — обновите страницу" };
    throw e;
  }
  const grant = await prisma.driveFolderGrant.findFirst({
    where: { id: grantId, folder: { projectId } },
    select: { folderId: true },
  });
  if (!grant) return { error: "Запись не найдена — обновите страницу" };
  const result = await syncProjectDriveAccess(projectId, {
    actorUserId: ctx.user.id!,
    trigger: "retry",
    folderIds: [grant.folderId],
  });
  revalidateProjectDrive(projectId);
  return syncState(result);
}
