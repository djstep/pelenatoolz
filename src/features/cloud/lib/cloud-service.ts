import type { CloudProvider } from "@prisma/client";
import {
  downloadGoogleFile,
  refreshGoogleToken,
} from "@/features/cloud/lib/google-drive";
import { decryptSecret, encryptSecret } from "@/features/cloud/lib/token-crypto";
import type { CloudEntry } from "@/features/cloud/lib/types";
import {
  downloadYandexFile,
  listYandexDiskFolder,
  refreshYandexToken,
} from "@/features/cloud/lib/yandex-disk";
import { listGoogleDriveFolder } from "@/features/cloud/lib/google-drive";
import { prisma } from "@/shared/db/prisma";

export async function getCloudConnection(userId: string, provider: CloudProvider) {
  return prisma.cloudConnection.findUnique({
    where: { userId_provider: { userId, provider } },
  });
}

export async function listUserCloudConnections(userId: string) {
  return prisma.cloudConnection.findMany({
    where: { userId },
    orderBy: { provider: "asc" },
    select: {
      id: true,
      provider: true,
      accountEmail: true,
      accountLabel: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
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
  const refreshed =
    conn.provider === "GOOGLE_DRIVE"
      ? await refreshGoogleToken(refresh)
      : await refreshYandexToken(refresh);

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

export async function browseCloudFolder(
  userId: string,
  provider: CloudProvider,
  folderKey: string,
): Promise<CloudEntry[]> {
  const conn = await getCloudConnection(userId, provider);
  if (!conn) {
    throw new Error("Облако не подключено");
  }
  const token = await getValidAccessToken(conn.id, userId);
  if (provider === "GOOGLE_DRIVE") {
    return listGoogleDriveFolder(token, folderKey || "root");
  }
  const path = folderKey || "/";
  return listYandexDiskFolder(token, path);
}

export async function downloadCloudFileForUser(
  userId: string,
  provider: CloudProvider,
  externalId: string,
  mimeType?: string | null,
) {
  const conn = await getCloudConnection(userId, provider);
  if (!conn) {
    throw new Error("Облако не подключено");
  }
  const token = await getValidAccessToken(conn.id, userId);
  if (provider === "GOOGLE_DRIVE") {
    return downloadGoogleFile(token, externalId, mimeType);
  }
  return downloadYandexFile(token, externalId);
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
