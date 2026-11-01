import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * IBM Plex Sans для печатных листов: официальные файлы IBM (github.com/IBM/plex, `@ibm/plex-sans`
 * 1.1.0, папка `fonts/split/woff2`) — латиница и кириллица отдельно, 400 / 600 / 700, без
 * изменений; лицензия SIL OFL 1.1 — `OFL.txt` рядом. Встраиваются в HTML как `data:` — лист
 * не ходит в сеть ни во вкладке, ни в iframe, ни в Chromium. Папка попадает в сборку через
 * `outputFileTracingIncludes` в `next.config.ts`.
 */
export const PLEX_FONT_DIR = path.join("assets", "fonts", "ibm-plex-sans");

/** Диапазоны символов — как в CSS из того же архива IBM. */
const UNICODE_RANGES = {
  Latin1:
    "U+0000, U+000D, U+0020-007E, U+00A0-00A3, U+00A4-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2013-2014, U+2018-201A, U+201C-201E, U+2020-2022, U+2026, U+2030, U+2039-203A, U+2044, U+2074, U+20AC, U+2122, U+2212, U+FB01-FB02",
  Cyrillic:
    "U+0400-045F, U+0472-0473, U+0490-049D, U+04A0-04A5, U+04AA-04AB, U+04AE-04B3, U+04B6-04BB, U+04C0-04C2, U+04CF-04D9, U+04DC-04DF, U+04E2-04E9, U+04EE-04F5, U+04F8-04F9",
} as const;

const WEIGHTS = [
  { file: "Regular", weight: 400 },
  { file: "SemiBold", weight: 600 },
  { file: "Bold", weight: 700 },
] as const;

/** Имена файлов шрифта в папке (для проверки, что всё на месте). */
export const PLEX_FONT_FILES = WEIGHTS.flatMap(({ file }) =>
  (Object.keys(UNICODE_RANGES) as (keyof typeof UNICODE_RANGES)[]).map(
    (subset) => `IBMPlexSans-${file}-${subset}.woff2`,
  ),
);

let cached: string | null = null;

/** `@font-face` с встроенными файлами. Читается с диска один раз на процесс. */
export function loadPlexFontCss(rootDir: string = process.cwd()): string {
  if (cached !== null && rootDir === process.cwd()) return cached;
  const rules: string[] = [];
  for (const { file, weight } of WEIGHTS) {
    for (const [subset, range] of Object.entries(UNICODE_RANGES)) {
      const data = readFileSync(
        path.join(rootDir, PLEX_FONT_DIR, `IBMPlexSans-${file}-${subset}.woff2`),
      ).toString("base64");
      rules.push(
        `@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:${weight};font-display:block;` +
          `src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${range};}`,
      );
    }
  }
  const css = rules.join("\n");
  if (rootDir === process.cwd()) cached = css;
  return css;
}
