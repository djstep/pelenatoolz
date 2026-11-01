import { createHash } from "crypto";
import { yandexEndpoints } from "@/features/cloud/lib/endpoints";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import type { CloudEntry } from "@/features/cloud/lib/types";

type YandexItem = {
  name: string;
  path: string;
  type: "dir" | "file";
  mime_type?: string;
  size?: number;
  modified?: string;
  public_url?: string;
};

export type YandexTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export async function listYandexDiskFolder(
  accessToken: string,
  path = "/",
): Promise<CloudEntry[]> {
  const diskPath = path === "/" ? "disk:/" : path.startsWith("disk:") ? path : `disk:${path}`;
  const url = new URL(`${yandexEndpoints().diskApi}/resources`);
  url.searchParams.set("path", diskPath);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "name");

  const res = await fetch(url, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (res.status === 401) {
    throw new CloudReconnectRequiredError("YANDEX_DISK");
  }
  if (!res.ok) {
    throw new CloudApiError("YANDEX_DISK", res.status, "Не удалось прочитать Яндекс Диск");
  }

  const data = (await res.json()) as {
    _embedded?: { items?: YandexItem[] };
  };

  return (data._embedded?.items ?? []).map((item) => ({
    id: item.path,
    name: item.name,
    kind: item.type === "dir" ? "folder" : "file",
    mimeType: item.mime_type ?? null,
    sizeBytes: item.size ?? null,
    modifiedAt: item.modified ?? null,
    webUrl: item.public_url ?? null,
    path: item.path,
  }));
}

/**
 * Id «устройства» для окна согласия Яндекса: токен, выданный под device_id, можно отозвать
 * (`/revoke_token`), и повторное подключение того же человека заменяет его прошлый токен.
 * Стабилен для человека, в нём нет самого userId.
 */
export function yandexDeviceId(userId: string) {
  return createHash("sha256").update(`pelena-yandex:${userId}`).digest("hex").slice(0, 32);
}

async function postYandexToken(body: URLSearchParams) {
  try {
    return await fetch(yandexEndpoints().token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new CloudApiError("YANDEX_DISK", 0, "Яндекс недоступен — попробуйте позже");
  }
}

export async function exchangeYandexCode(code: string) {
  const res = await postYandexToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.YANDEX_CLIENT_ID ?? "",
      client_secret: process.env.YANDEX_CLIENT_SECRET ?? "",
    }),
  );
  if (!res.ok) {
    throw new CloudApiError("YANDEX_DISK", res.status, "Яндекс не выдал доступ — попробуйте подключить ещё раз");
  }
  return (await res.json()) as YandexTokenResponse;
}

/** Обновление токена. 400 `invalid_grant` или 401 — доступ отозван: только переподключение. */
export async function refreshYandexToken(refreshToken: string) {
  const res = await postYandexToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.YANDEX_CLIENT_ID ?? "",
      client_secret: process.env.YANDEX_CLIENT_SECRET ?? "",
    }),
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (data?.error === "invalid_grant" || res.status === 401) {
      throw new CloudReconnectRequiredError("YANDEX_DISK", data?.error);
    }
    throw new CloudApiError("YANDEX_DISK", res.status, "Не удалось обновить доступ к Яндекс Диску — попробуйте позже");
  }
  return (await res.json()) as YandexTokenResponse;
}

/** Отзыв токена у Яндекса. Не бросает: результат — удалось ли. */
export async function revokeYandexToken(accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(yandexEndpoints().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        client_id: process.env.YANDEX_CLIENT_ID ?? "",
        client_secret: process.env.YANDEX_CLIENT_SECRET ?? "",
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Id и почта аккаунта. Почты нет, если в приложении Яндекса не отмечен доступ к ней. */
export async function fetchYandexAccount(accessToken: string) {
  try {
    const res = await fetch(`${yandexEndpoints().userInfo}?format=json`, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (!res.ok) return { id: null, email: null };
    const data = (await res.json()) as {
      id?: string;
      default_email?: string;
      login?: string;
    };
    return {
      id: data.id ?? null,
      email: data.default_email ?? data.login ?? null,
    };
  } catch {
    return { id: null, email: null };
  }
}

export async function downloadYandexFile(accessToken: string, path: string) {
  const hrefUrl = new URL(`${yandexEndpoints().diskApi}/resources/download`);
  hrefUrl.searchParams.set("path", path);

  const meta = await fetch(hrefUrl, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!meta.ok) {
    throw new Error(`Yandex download meta failed: ${meta.status}`);
  }
  const { href } = (await meta.json()) as { href: string };
  const fileRes = await fetch(href);
  if (!fileRes.ok) {
    throw new Error(`Yandex download failed: ${fileRes.status}`);
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mimeType =
    fileRes.headers.get("content-type") ?? "application/octet-stream";
  return { buffer, mimeType };
}
