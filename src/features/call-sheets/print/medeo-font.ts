import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Medeo Sans для печатного листа: npm-пакет `medeo-font` (версия зафиксирована точно, лицензия
 * SIL OFL 1.1 — `LICENSE.txt` в пакете). Встраивается только вариативный прямой файл
 * (веса 100–900), курсив не встраивается. В HTML — `data:`, лист не ходит в сеть ни во вкладке,
 * ни в iframe, ни в Chromium. Файл попадает в сборку через `outputFileTracingIncludes`.
 */
export const MEDEO_FONT_SPECIFIER = "medeo-font/fonts/medeo-sans/MedeoSansVariable.woff2";

/** Путь к файлу шрифта в node_modules (поиск — от корня проекта). */
export function medeoFontPath(rootDir: string = process.cwd()): string {
  const resolveFromRoot = createRequire(path.join(rootDir, "package.json"));
  return resolveFromRoot.resolve(MEDEO_FONT_SPECIFIER);
}

let cached: string | null = null;

/** `@font-face` со встроенным файлом. Читается с диска один раз на процесс. */
export function loadMedeoFontCss(): string {
  if (cached !== null) return cached;
  const data = readFileSync(medeoFontPath()).toString("base64");
  cached =
    `@font-face{font-family:"Medeo Sans";font-style:normal;font-weight:100 900;font-display:block;` +
    `src:url(data:font/woff2;base64,${data}) format("woff2");}`;
  return cached;
}
