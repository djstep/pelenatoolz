import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Medeo Sans для печатного листа: npm-пакет `medeo-font` (версия зафиксирована точно, лицензия
 * SIL OFL 1.1 — `LICENSE.txt` в пакете). Используется только вариативный прямой файл
 * (веса 100–900), курсива нет. Два способа подключить:
 * - встроить (`data:`) — для печати / PDF: лист не ходит в сеть ни во вкладке, ни в Chromium;
 * - адресом `MEDEO_FONT_URL` — для просмотра на странице: файл кэшируется браузером навсегда
 *   (в имени — версия пакета), HTML листа остаётся лёгким.
 * Файл попадает в сборку через `outputFileTracingIncludes`.
 */
export const MEDEO_FONT_SPECIFIER = "medeo-font/fonts/medeo-sans/MedeoSansVariable.woff2";

/** Версия пакета `medeo-font` — та же, что в `package.json` (сверяет тест). */
export const MEDEO_FONT_VERSION = "1.0.0-rc.4.1";

/** Имя файла с версией: новая версия пакета — новый адрес, старый кэш не мешает. */
export const MEDEO_FONT_FILE_NAME = `medeo-sans-variable-${MEDEO_FONT_VERSION}.woff2`;

/** Адрес файла шрифта на сайте (маршрут `api/fonts/[file]`). */
export const MEDEO_FONT_URL = `/api/fonts/${MEDEO_FONT_FILE_NAME}`;

/** Путь к файлу шрифта в node_modules (поиск — от корня проекта). */
export function medeoFontPath(rootDir: string = process.cwd()): string {
  const resolveFromRoot = createRequire(path.join(rootDir, "package.json"));
  return resolveFromRoot.resolve(MEDEO_FONT_SPECIFIER);
}

let cachedFile: Buffer | null = null;

/** Файл шрифта. Читается с диска один раз на процесс. */
export function readMedeoFontFile(): Buffer {
  cachedFile ??= readFileSync(medeoFontPath());
  return cachedFile;
}

const FONT_FACE_START =
  `@font-face{font-family:"Medeo Sans";font-style:normal;font-weight:100 900;font-display:block;`;

let cachedEmbedded: string | null = null;

/** `@font-face` со встроенным файлом (`data:`). */
export function loadMedeoFontCss(): string {
  cachedEmbedded ??=
    `${FONT_FACE_START}src:url(data:font/woff2;base64,${readMedeoFontFile().toString("base64")}) format("woff2");}`;
  return cachedEmbedded;
}

/** `@font-face` с адресом файла на сайте. */
export function medeoFontUrlCss(): string {
  return `${FONT_FACE_START}src:url(${MEDEO_FONT_URL}) format("woff2");}`;
}
