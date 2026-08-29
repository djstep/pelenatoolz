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

export async function listYandexDiskFolder(
  accessToken: string,
  path = "/",
): Promise<CloudEntry[]> {
  const diskPath = path === "/" ? "disk:/" : path.startsWith("disk:") ? path : `disk:${path}`;
  const url = new URL("https://cloud-api.yandex.net/v1/disk/resources");
  url.searchParams.set("path", diskPath);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "name");

  const res = await fetch(url, {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Яндекс.Диск: ${res.status} ${text}`);
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

export async function refreshYandexToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.YANDEX_CLIENT_ID ?? "",
    client_secret: process.env.YANDEX_CLIENT_SECRET ?? "",
  });
  const res = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Yandex token refresh failed: ${res.status}`);
  }
  return (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
}

export async function fetchYandexUserEmail(accessToken: string) {
  const res = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    default_email?: string;
    login?: string;
  };
  return data.default_email ?? data.login ?? null;
}

export async function downloadYandexFile(accessToken: string, path: string) {
  const hrefUrl = new URL(
    "https://cloud-api.yandex.net/v1/disk/resources/download",
  );
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
