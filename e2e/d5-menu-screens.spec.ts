import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { type E2ERoleKey } from "./fixtures/data";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Снимки меню проекта: продюсер, без финансов, crewonly; обе темы, 1280 px, разделы раскрыты,
 * чтобы был виден полный состав. Только по команде: `E2E_MENU_SHOTS=<папка>`.
 * `E2E_MENU_BAR=<адрес без косой черты в начале>` — ещё снимок страницы с полосой вкладок на 390 px.
 */

const DIR = process.env.E2E_MENU_SHOTS;
const BAR = process.env.E2E_MENU_BAR;
const ctx = e2eContext();

test.skip(!DIR, "только с E2E_MENU_SHOTS");

/** Переключение темы плавное: снимок сразу после него попадает в середину перехода. */
const THEME_SETTLE_MS = 500;
/** Раскрытие раздела тоже плавное. */
const OPEN_SETTLE_MS = 300;
/** Высота окна, в которую меню помещается целиком. */
const TALL = 1500;

async function openAllSections(page: Page) {
  const closed = page.locator('nav button[aria-expanded="false"]');
  // Состояние меню читается после загрузки: ждём, пока раскроются разделы по умолчанию.
  await expect(page.locator('nav button[aria-expanded="true"]').first()).toBeVisible();
  while ((await closed.count()) > 0) await closed.first().click();
  await page.waitForTimeout(OPEN_SETTLE_MS);
}

async function setTheme(page: Page, theme: string) {
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForTimeout(THEME_SETTLE_MS);
}

for (const role of ["producer", "nofin", "crewonly"] as const satisfies readonly E2ERoleKey[]) {
  test.describe(role, () => {
    test.use({ storageState: storageStatePath(role), viewport: { width: 1280, height: TALL } });

    test("меню, обе темы", async ({ page }) => {
      await page.goto(projectPath(ctx));
      await openAllSections(page);
      for (const theme of ["light", "dark"]) {
        await setTheme(page, theme);
        await page.screenshot({ path: path.join(DIR!, `menu-${role}-${theme}-1280.png`) });
      }
    });

    test("полоса вкладок на 390 px", async ({ page }) => {
      test.skip(!BAR, "только с E2E_MENU_BAR");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(projectPath(ctx, `/${BAR}`));
      for (const theme of ["light", "dark"]) {
        await setTheme(page, theme);
        await page.screenshot({ path: path.join(DIR!, `bar-${role}-${theme}-390.png`) });
      }
    });
  });
}
