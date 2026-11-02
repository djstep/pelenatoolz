import type { CloudProvider } from "@prisma/client";

/** Google: только файлы, созданные самим приложением, + почта и id аккаунта из id_token. */
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_REQUESTED_SCOPE = `${GOOGLE_DRIVE_FILE_SCOPE} openid email`;

/** Яндекс: чтение и запись только в папке приложения «Приложения/<название>». */
export const YANDEX_APP_FOLDER_SCOPE = "cloud_api:disk.app_folder";

const REQUIRED_SCOPE: Record<CloudProvider, string> = {
  GOOGLE_DRIVE: GOOGLE_DRIVE_FILE_SCOPE,
  YANDEX_DISK: YANDEX_APP_FOLDER_SCOPE,
};

export function parseScopes(scopes: string | null | undefined): string[] {
  return (scopes ?? "").split(/[\s,]+/).filter(Boolean);
}

export function hasRequiredScope(provider: CloudProvider, scopes: string | null | undefined) {
  return parseScopes(scopes).includes(REQUIRED_SCOPE[provider]);
}

/**
 * Почему подключение не годится для записи:
 * `revoked` — доступ отозван (у провайдера или при переподключении),
 * `old_scopes` — подключено до волны дисков (`drive.readonly`, `disk.read`) или человек снял галочку.
 */
export type ReconnectReason = "revoked" | "old_scopes";

export function connectionReconnectReason(conn: {
  provider: CloudProvider;
  scopes: string | null;
  needsReconnectAt: Date | string | null;
}): ReconnectReason | null {
  if (conn.needsReconnectAt) return "revoked";
  if (!hasRequiredScope(conn.provider, conn.scopes)) return "old_scopes";
  return null;
}

export function reconnectReasonText(provider: CloudProvider, reason: ReconnectReason) {
  const disk = provider === "GOOGLE_DRIVE" ? "Google Диск" : "Яндекс Диск";
  return reason === "revoked"
    ? `${disk}: доступ отозван или истёк — переподключите`
    : `${disk} подключён по-старому — переподключите`;
}
