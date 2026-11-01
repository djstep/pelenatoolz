import type { CloudConnection, CloudProvider } from "@prisma/client";
import {
  downloadGoogleFile,
  listGoogleDriveFolder,
  refreshGoogleToken,
  revokeGoogleToken,
} from "@/features/cloud/lib/google-drive";
import { CloudReconnectRequiredError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import { connectionReconnectReason } from "@/features/cloud/lib/scopes";
import { decryptSecret, encryptSecret } from "@/features/cloud/lib/token-crypto";
import { cloudProviderLabels, type CloudEntry } from "@/features/cloud/lib/types";
import {
  downloadYandexFile,
  listYandexDiskFolder,
  refreshYandexToken,
  revokeYandexToken,
} from "@/features/cloud/lib/yandex-disk";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export async function getCloudConnection(userId: string, provider: CloudProvider) {
  return prisma.cloudConnection.findUnique({
    where: { userId_provider: { userId, provider } },
  });
}

export async function listUserCloudConnections(userId: string) {
  const rows = await prisma.cloudConnection.findMany({
    where: { userId },
    orderBy: { provider: "asc" },
    select: {
      id: true,
      provider: true,
      accountEmail: true,
      accountLabel: true,
      scopes: true,
      needsReconnectAt: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map(({ scopes, needsReconnectAt, ...row }) => ({
    ...row,
    reconnectReason: connectionReconnectReason({ provider: row.provider, scopes, needsReconnectAt }),
  }));
}

export type UserCloudConnection = Awaited<ReturnType<typeof listUserCloudConnections>>[number];

/**
 * Пометить «нужно переподключить» (доступ отозван у провайдера). Журнал — один раз,
 * при первой пометке: повторные ошибки того же подключения запись не множат.
 */
export async function markCloudConnectionNeedsReconnect(
  conn: Pick<CloudConnection, "id" | "userId" | "provider">,
) {
  const { count } = await prisma.cloudConnection.updateMany({
    where: { id: conn.id, needsReconnectAt: null },
    data: { needsReconnectAt: new Date() },
  });
  if (count === 0) return;
  await recordAudit(
    { user: { id: conn.userId } },
    {
      projectId: null,
      entityType: AuditEntityType.cloudConnection,
      entityId: conn.id,
      action: "UPDATE",
      summary: `${cloudProviderLabels[conn.provider]}: доступ отозван — нужно переподключить`,
      changes: { provider: conn.provider, needsReconnect: true },
    },
  );
}

export async function getValidAccessToken(
  connectionId: string,
  userId: string,
): Promise<string> {
  const conn = await prisma.cloudConnection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!conn) {
    throw new Error("Подключение не найдено");
  }
  if (connectionReconnectReason(conn)) {
    throw new CloudReconnectRequiredError(conn.provider);
  }

  const accessToken = decryptSecret(conn.accessToken);
  const expiresSoon =
    conn.expiresAt != null &&
    conn.expiresAt.getTime() - Date.now() < 60_000;

  if (!expiresSoon) {
    return accessToken;
  }

  if (!conn.refreshToken) {
    return accessToken;
  }

  const refresh = decryptSecret(conn.refreshToken);
  let refreshed;
  try {
    refreshed =
      conn.provider === "GOOGLE_DRIVE"
        ? await refreshGoogleToken(refresh)
        : await refreshYandexToken(refresh);
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) await markCloudConnectionNeedsReconnect(conn);
    throw e;
  }

  const expiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null;

  await prisma.cloudConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: encryptSecret(refreshed.access_token),
      refreshToken: refreshed.refresh_token
        ? encryptSecret(refreshed.refresh_token)
        : conn.refreshToken,
      expiresAt,
    },
  });

  return refreshed.access_token;
}

/**
 * Запрос к личному диску с действующим токеном. Ответ провайдера «доступ отозван»
 * (`CloudReconnectRequiredError` из клиентов API) помечает подключение и пробрасывается дальше —
 * вызывающий показывает человеку понятную ошибку, а не падает.
 */
export async function withCloudAccessToken<T>(
  userId: string,
  provider: CloudProvider,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const conn = await getCloudConnection(userId, provider);
  if (!conn) {
    throw new Error(`${cloudProviderLabels[provider]} не подключён`);
  }
  const token = await getValidAccessToken(conn.id, userId);
  try {
    return await fn(token);
  } catch (e) {
    if (isCloudReconnectRequiredError(e)) await markCloudConnectionNeedsReconnect(conn);
    throw e;
  }
}

/**
 * Отозвать токены подключения у провайдера. Не бросает: подключение в базе удаляется /
 * переподключается в любом случае. Google: отзыв refresh-токена снимает всё разрешение.
 */
export async function revokeCloudConnectionTokens(
  conn: Pick<CloudConnection, "provider" | "accessToken" | "refreshToken">,
) {
  let ok = false;
  try {
    if (conn.provider === "GOOGLE_DRIVE") {
      const token = decryptSecret(conn.refreshToken ?? conn.accessToken);
      ok = await revokeGoogleToken(token);
    } else {
      ok = await revokeYandexToken(decryptSecret(conn.accessToken));
    }
  } catch {
    // Не расшифровался (сменили ключ) — отзывать нечего, токен у провайдера истечёт сам.
    ok = false;
  }
  if (!ok) {
    console.warn(`[cloud] не удалось отозвать токен ${conn.provider} — отзовите доступ в аккаунте вручную`);
  }
  return ok;
}

/**
 * Перед окном согласия при переподключении: старый токен отзывается сразу (у Google отзыв
 * после получения нового снял бы и новый), подключение — «нужно переподключить», пока не
 * вернётся новое. Уже помеченное — не трогаем.
 */
export async function revokeBeforeReconnect(userId: string, provider: CloudProvider) {
  const conn = await getCloudConnection(userId, provider);
  if (!conn || conn.needsReconnectAt) return;
  await revokeCloudConnectionTokens(conn);
  await prisma.cloudConnection.updateMany({
    where: { id: conn.id, needsReconnectAt: null },
    data: { needsReconnectAt: new Date() },
  });
}

/** Сохранить подключение после окна согласия; журнал — «подключён» или «переподключён». */
export async function saveCloudConnection(input: {
  userId: string;
  provider: CloudProvider;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string;
  accountEmail: string | null;
  accountSubject: string | null;
}) {
  const label = cloudProviderLabels[input.provider];
  const before = await getCloudConnection(input.userId, input.provider);
  const expiresAt = input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000) : null;
  const fields = {
    accountEmail: input.accountEmail,
    accountLabel: input.accountEmail ?? label,
    accountSubject: input.accountSubject,
    scopes: input.scopes,
    needsReconnectAt: null,
    accessToken: encryptSecret(input.accessToken),
    expiresAt,
  };

  const saved = await prisma.cloudConnection.upsert({
    where: { userId_provider: { userId: input.userId, provider: input.provider } },
    create: {
      userId: input.userId,
      provider: input.provider,
      ...fields,
      refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : null,
    },
    update: {
      ...fields,
      refreshToken: input.refreshToken ? encryptSecret(input.refreshToken) : undefined,
    },
  });

  // Без почт: в журнале только факт, провайдер, права и сменился ли аккаунт.
  await recordAudit(
    { user: { id: input.userId } },
    {
      projectId: null,
      entityType: AuditEntityType.cloudConnection,
      entityId: saved.id,
      action: before ? "UPDATE" : "CREATE",
      summary: before ? `Переподключён личный ${label}` : `Подключён личный ${label}`,
      changes: {
        provider: input.provider,
        scopes: input.scopes,
        ...(before && before.accountSubject !== input.accountSubject
          ? { accountChanged: true }
          : {}),
      },
    },
  );
  return saved;
}

export async function browseCloudFolder(
  userId: string,
  provider: CloudProvider,
  folderKey: string,
): Promise<CloudEntry[]> {
  return withCloudAccessToken(userId, provider, (token) => {
    if (provider === "GOOGLE_DRIVE") {
      return listGoogleDriveFolder(token, folderKey || "root");
    }
    return listYandexDiskFolder(token, folderKey || "/");
  });
}

export async function downloadCloudFileForUser(
  userId: string,
  provider: CloudProvider,
  externalId: string,
  mimeType?: string | null,
) {
  return withCloudAccessToken(userId, provider, (token) => {
    if (provider === "GOOGLE_DRIVE") {
      return downloadGoogleFile(token, externalId, mimeType);
    }
    return downloadYandexFile(token, externalId);
  });
}

export async function listProjectCloudFiles(projectId: string) {
  return prisma.cloudFileLink.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      connection: {
        select: { accountEmail: true, provider: true },
      },
    },
  });
}
