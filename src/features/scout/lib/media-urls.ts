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

/** То же для фото: своя загрузка с полным адресом своего сайта → путь `/uploads/...`. */
export function parsePhotoUrls(raw: string | undefined) {
  return parseMediaUrls(raw).map(({ url }) => ({ url: toOwnUploadPath(url) }));
}
