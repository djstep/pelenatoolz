import { attachmentDisposition } from "@/features/call-sheets/print/print-source";
import type { Permission } from "@/features/memberships/permissions";

type Can = (permission: Permission) => boolean;

/** Настоящий тип видео по расширению, если браузер его не прислал: `video/mov` Safari может не принять. */
export function videoTypeOf(ext: string) {
  const known: Record<string, string> = {
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
  };
  return known[ext] ?? `video/${ext}`;
}

/** Эти типы браузер открывает во вкладке и не выполняет. SVG здесь нет: в нём работают скрипты. */
const VIEW_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);
/** Без `+`: тип вида `video/x+xml` браузер открыл бы как XML-страницу со скриптами. */
const PLAYER_TYPE = /^(video|audio)\/[a-z0-9.-]+$/;

const SANDBOX_CSP = "default-src 'none'; sandbox";
/** Видео во вкладке играет только с `allow-same-origin` (проверено в Chromium). Скрипты всё равно закрыты. */
const PLAYER_CSP = "default-src 'none'; media-src 'self'; sandbox allow-same-origin";

/**
 * Тип файла присылает браузер загрузившего, поэтому ему не доверяем: всё, кроме белого списка,
 * скачивается как двоичный файл. Иначе HTML выполнился бы на адресе сайта, а файл с типом
 * text/javascript можно было бы подключить тегом `<script>`.
 */
export function projectFileHeaders(mimeType: string, originalName: string) {
  const player = PLAYER_TYPE.test(mimeType);
  const inline = player || VIEW_TYPES.has(mimeType);
  const disposition = attachmentDisposition(originalName);
  return {
    "Content-Type": inline ? mimeType : "application/octet-stream",
    "Content-Disposition": inline ? disposition.replace(/^attachment/, "inline") : disposition,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": player ? PLAYER_CSP : SANDBOX_CSP,
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
