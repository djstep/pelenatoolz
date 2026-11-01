import { safePrintUrl } from "@/shared/lib/escape-html";
import { toOwnUploadPath } from "@/shared/lib/own-upload-url";

/** Адреса из поля «по одному на строку» → `[{ url }]`, пустые строки пропускаются. */
export function parseMediaUrls(raw: string | undefined) {
  if (!raw?.trim()) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

/**
 * То же для фото: сначала полный адрес своего сайта → путь `/uploads/...`, потом проверка —
 * http(s) или путь сайта. Хоть одна строка не прошла — `null`.
 */
export function parsePhotoUrls(raw: string | undefined) {
  const photos = parseMediaUrls(raw).map(({ url }) => ({ url: toOwnUploadPath(url) }));
  return photos.every(({ url }) => safePrintUrl(url) !== null) ? photos : null;
}
