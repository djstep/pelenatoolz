import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * (Г) Скриншоты ключевых экранов на 1280 и 390 px — в `e2e/screenshots/` (в .gitignore), для
 * просмотра глазами. Тест не падает от вёрстки: ширина страницы шире экрана записывается
 * в `e2e/screenshots/overflow.json` и в пометки теста.
 */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);
const OUT = path.join(__dirname, "screenshots");

const SCREENS: { name: string; path: string }[] = [
  { name: "overview", path: projectPath(ctx) },
  { name: "libretto", path: projectPath(ctx, "/libretto") },
  { name: "schedule", path: projectPath(ctx, "/schedule") },
  { name: "call-sheets", path: projectPath(ctx, "/call-sheets") },
  { name: "call-sheet-day1", path: projectPath(ctx, `/call-sheets/${day1}`) },
  { name: "report-day1", path: projectPath(ctx, `/reports/${day1}`) },
  { name: "casting", path: projectPath(ctx, "/preproduction/casting") },
  { name: "smeta", path: projectPath(ctx, "/smeta") },
];

const WIDTHS = [1280, 390] as const;
const overflow: Record<string, number> = {};
/** Ошибки в консоли браузера по экранам (в dev — то, что Next показывает как «N Issues»). */
const consoleErrors: Record<string, string[]> = {};

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "overflow.json"), JSON.stringify(overflow, null, 2));
  writeFileSync(path.join(OUT, "console-errors.json"), JSON.stringify(consoleErrors, null, 2));
});

for (const role of ["producer", "nofin"] as const) {
  test.describe(role, () => {
    test.use({ storageState: storageStatePath(role) });
    for (const width of WIDTHS) {
      test(`${role} ${width}px`, async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        let current = "";
        page.on("console", (msg) => {
          if (msg.type() !== "error" || !current) return;
          (consoleErrors[current] ??= []).push(msg.text().slice(0, 300));
        });
        for (const screen of SCREENS) {
          current = `${role}/${width}/${screen.name}`;
          await page.goto(screen.path);
          await page.waitForLoadState("networkidle");
          const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
          if (scroll > width + 1) {
            overflow[`${role}/${width}/${screen.name}`] = scroll;
            test.info().annotations.push({ type: "шире экрана", description: `${screen.name}: ${scroll}px` });
          }
          await page.screenshot({ path: path.join(OUT, `${role}-${width}-${screen.name}.png`), fullPage: width === 390 });
        }
      });
    }
  });
}
