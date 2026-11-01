import { safeRedirectPath } from "@/shared/lib/safe-redirect";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Текст для HTML, собранного строкой (печать, новая вкладка): и между тегами,
 * и внутри атрибута в любых кавычках.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Первая строка `<head>` каждой печатной страницы: скрипты в ней не выполняются,
 * даже если что-то проскочило мимо экранирования. Печать вызывается из открывшего окна.
 */
export const PRINT_HTML_CSP_META = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">`;

/** Полный адрес с протоколом `http:` или `https:` (протокол — по разбору `new URL`). */
export function isHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Путь сайта: один «/» в начале, без «//», «/\», обратных слэшей и управляющих символов. */
export function isSitePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && safeRedirectPath(trimmed, "") === trimmed;
}

/**
 * Адрес для `href`/`src` в печати: `http(s)` или путь сайта, иначе `null` —
 * тогда ссылка или картинка не выводится. В атрибуте результат всё равно экранировать.
 */
export function safePrintUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isHttpUrl(trimmed) || isSitePath(trimmed) ? trimmed : null;
}
