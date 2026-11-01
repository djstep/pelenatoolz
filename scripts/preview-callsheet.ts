/**
 * Превью печатного листа вызывного без входа и без базы: HTML из фикстур (насыщенный и
 * минимальный день) → `preview/callsheet-full.html`, `preview/callsheet-min.html`.
 * Если найден Chrome / Chromium (переменная `CHROME_PATH` или обычные места установки) —
 * ещё PDF A4 и PNG рядом. Ничего не ставит и в базу не ходит.
 *
 *   npm run preview:callsheet
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildCallSheetHtml } from "../src/features/call-sheets/print/print-html";
import { buildCallSheetPrintModel } from "../src/features/call-sheets/print/print-model";
import { loadPlexFontCss } from "../src/features/call-sheets/print/plex-font";
import {
  FULL_DAY_SOURCE,
  MIN_DAY_SOURCE,
} from "../src/features/call-sheets/print/preview-fixtures";

const OUT_DIR = path.join(process.cwd(), "preview");

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

function findChrome() {
  return CHROME_CANDIDATES.find((p): p is string => Boolean(p) && existsSync(p!)) ?? null;
}

function kb(file: string) {
  return `${(statSync(file).size / 1024).toFixed(0)} КБ`;
}

function render(chrome: string, htmlFile: string, base: string) {
  const url = pathToFileURL(htmlFile).href;
  const common = ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars"];
  const pdf = `${base}.pdf`;
  const png = `${base}.png`;
  execFileSync(chrome, [...common, "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, url], {
    stdio: "ignore",
  });
  // 794 px — ширина A4 при 96 dpi; высота с запасом, чтобы было видно, где кончается лист.
  execFileSync(chrome, [...common, "--window-size=794,2246", `--screenshot=${png}`, url], {
    stdio: "ignore",
  });
  console.log(`  ${path.relative(process.cwd(), pdf)} (${kb(pdf)}), ${path.relative(process.cwd(), png)}`);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fontCss = loadPlexFontCss();
  const chrome = findChrome();
  const variants = [
    { name: "callsheet-full", source: FULL_DAY_SOURCE },
    { name: "callsheet-min", source: MIN_DAY_SOURCE },
  ];
  for (const { name, source } of variants) {
    const html = buildCallSheetHtml(buildCallSheetPrintModel(source), { fontCss });
    const file = path.join(OUT_DIR, `${name}.html`);
    writeFileSync(file, html, "utf8");
    console.log(`${path.relative(process.cwd(), file)} (${kb(file)})`);
    if (chrome) render(chrome, file, path.join(OUT_DIR, name));
  }
  console.log(`Шрифт в HTML: ${(Buffer.byteLength(fontCss) / 1024).toFixed(0)} КБ`);
  if (!chrome) console.log("Chrome не найден — только HTML (путь можно задать в CHROME_PATH).");
}

main();
