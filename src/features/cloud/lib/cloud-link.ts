import type { CloudProvider } from "@prisma/client";

const MAX_URL_LENGTH = 2000;
export const MAX_LINK_NAME_LENGTH = 200;

const GOOGLE_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
const YANDEX_HOSTS = new Set(["disk.yandex.ru", "disk.yandex.com", "disk.360.yandex.ru", "yadi.sk"]);

export type ParsedCloudLink = {
  /** Google Диск / Яндекс Диск по адресу; ссылка на другой сайт — null. */
  provider: CloudProvider | null;
  /** Id файла Google из адреса; если не нашёлся (и для остальных) — сам адрес. */
  externalId: string;
  url: string;
};

/**
 * «Вставить ссылку» на «Файлах»: любой https-адрес. http, javascript:, data: и прочее — отказ
 * (адрес потом стоит в href у всех участников). Иначе — текст ошибки для человека.
 */
export function parseCloudLink(raw: string): ParsedCloudLink | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Вставьте адрес" };
  if (value.length > MAX_URL_LENGTH) return { error: "Слишком длинный адрес" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: "Это не адрес ссылки" };
  }
  if (url.protocol !== "https:") return { error: "Адрес должен начинаться с https://" };
  if (url.username || url.password || !url.hostname) return { error: "Это не адрес ссылки" };

  const host = url.hostname.toLowerCase();
  if (GOOGLE_HOSTS.has(host)) {
    // /file/d/<id>/view, /spreadsheets/d/<id>/edit, /drive/folders/<id>, ?id=<id>
    const fromPath = url.pathname.match(/\/(?:d|folders)\/([A-Za-z0-9_-]{10,})/)?.[1];
    const fromQuery = url.searchParams.get("id");
    const id = fromPath ?? (fromQuery && /^[A-Za-z0-9_-]{10,}$/.test(fromQuery) ? fromQuery : null);
    return { provider: "GOOGLE_DRIVE", externalId: id ?? url.toString(), url: url.toString() };
  }
  if (YANDEX_HOSTS.has(host)) {
    return { provider: "YANDEX_DISK", externalId: url.toString(), url: url.toString() };
  }
  return { provider: null, externalId: url.toString(), url: url.toString() };
}

/** Колонка «Источник» для ссылки на другой сайт: имя сайта без «www.». */
export function linkSiteLabel(url: string | null | undefined): string {
  if (!url) return "Ссылка";
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Ссылка";
  } catch {
    return "Ссылка";
  }
}

/** Старые ссылки в базе могли прийти без проверки: в href — только http(s). */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
