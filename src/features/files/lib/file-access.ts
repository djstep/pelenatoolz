import { attachmentDisposition } from "@/features/call-sheets/print/print-source";
import type { Permission } from "@/features/memberships/permissions";

type Can = (permission: Permission) => boolean;

/** Только эти типы браузер открывает на странице. SVG здесь нет: в нём работают скрипты. */
const INLINE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]);

/**
 * Тип файла присылает браузер загрузившего, поэтому ему не доверяем: всё, что не обычная картинка,
 * скачивается, а не выполняется на адресе сайта. Тег `<video>` на `attachment` не смотрит.
 */
export function projectFileHeaders(mimeType: string, originalName: string) {
  const playable = INLINE_TYPES.has(mimeType) || /^(video|audio)\/[a-z0-9.+-]+$/.test(mimeType);
  return {
    // Иначе загруженный файл с типом text/javascript можно подключить тегом `<script>`.
    "Content-Type": playable ? mimeType : "application/octet-stream",
    "Content-Disposition": INLINE_TYPES.has(mimeType)
      ? `inline; filename="${encodeURIComponent(originalName)}"`
      : attachmentDisposition(originalName),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}

/** Файл договора или акта открывает и меняет только право на договоры. */
export function canReadProjectFile(can: Can, contractsOnly: boolean) {
  if (contractsOnly) return can("contracts:read");
  return can("cast:read") || can("project:read") || can("script:read");
}

export function canDeleteProjectFile(can: Can, contractsOnly: boolean) {
  if (!can("script:write") && !can("project:write")) return false;
  return !contractsOnly || can("contracts:write");
}
