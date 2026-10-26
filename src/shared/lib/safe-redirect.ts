const MAX_REDIRECT_PATH_LENGTH = 2000;

function hasControlChars(value: string) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Адрес возврата только внутри сайта: путь с одним «/» в начале.
 * «//чужой-сайт», «/\чужой-сайт», полный адрес, обратный слэш и управляющие
 * символы не проходят — тогда возвращается fallback.
 */
export function safeRedirectPath(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  if (input.length > MAX_REDIRECT_PATH_LENGTH) return fallback;
  if (!input.startsWith("/")) return fallback;
  if (input[1] === "/" || input[1] === "\\") return fallback;
  if (input.includes("\\")) return fallback;
  if (hasControlChars(input)) return fallback;
  return input;
}
