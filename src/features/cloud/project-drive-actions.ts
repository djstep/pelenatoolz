"use server";

import { revalidatePath } from "next/cache";
import type { CloudActionState } from "@/features/cloud/actions";
import { isCloudApiError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
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
