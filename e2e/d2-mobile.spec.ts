import { expect, test } from "@playwright/test";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * (Г) Телефон, 390 px: страница не шире экрана (нет горизонтальной прокрутки), меню проекта
 * свёрнуто — первым экраном содержимое; шапка — тема и меню аккаунта.
 */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);
const WIDTH = 390;

const PAGES: { name: string; path: string; heading: RegExp }[] = [
  { name: "проекты", path: "/ru/projects", heading: /Мои проекты/ },
  { name: "обзор", path: projectPath(ctx), heading: /Обзор проекта/ },
  { name: "либретто", path: projectPath(ctx, "/libretto"), heading: /Сцены \(либретто\)/ },
  { name: "КПП", path: projectPath(ctx, "/schedule"), heading: /КПП и вызывные/ },
  { name: "вызывные", path: projectPath(ctx, "/call-sheets"), heading: /Вызывные/ },
  { name: "вызывной дня 1", path: projectPath(ctx, `/call-sheets/${day1}`), heading: /Вызывной · День 1/ },
  { name: "отчёт смены", path: projectPath(ctx, `/reports/${day1}`), heading: /Производственный отчёт · День 1/ },
  { name: "кастинг", path: projectPath(ctx, "/preproduction/casting"), heading: /Кастинг/ },
  { name: "сметы", path: projectPath(ctx, "/smeta"), heading: /^Сметы$|Нет доступа к сметам/ },
  { name: "персонаж", path: projectPath(ctx, `/characters/${ctx.characterId}`), heading: /Иван/ },
  { name: "локации", path: projectPath(ctx, "/locations"), heading: /Локации/ },
];

for (const role of ["producer", "nofin"] as const) {
  test.describe(`${role}, ${WIDTH} px`, () => {
    test.use({ storageState: storageStatePath(role), viewport: { width: WIDTH, height: 844 } });

    for (const p of PAGES) {
      test(`${p.name}: нет горизонтальной прокрутки, содержимое — первым экраном`, async ({ page }) => {
        await page.goto(p.path);
        await page.waitForLoadState("networkidle");
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(width, `ширина страницы ${width}px`).toBeLessThanOrEqual(WIDTH);
        // Содержимое страницы начинается в первом экране, а не под меню проекта.
        const main = page.locator("main").first();
        const hasMain = (await main.count()) > 0;
        await expect((hasMain ? main : page.locator("body")).getByText(p.heading).first()).toBeVisible();
        if (hasMain) {
          const box = await main.boundingBox();
          expect(box && box.y < 200, `содержимое начинается на ${box?.y}px`).toBe(true);
        }
      });
    }
  });
}

test.describe("меню на телефоне", () => {
  test.use({ storageState: storageStatePath("producer"), viewport: { width: WIDTH, height: 844 } });

  test("меню проекта: свёрнуто, открывается кнопкой, переход закрывает", async ({ page }) => {
    await page.goto(projectPath(ctx));
    const menuButton = page.getByRole("button", { name: "Меню", exact: true });
    await expect(page.getByRole("link", { name: "КПП", exact: true })).toBeHidden();
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("link", { name: "КПП", exact: true }).click();
    await expect(page).toHaveURL(/\/schedule$/);
    await expect(page.getByRole("link", { name: "КПП", exact: true })).toBeHidden();
    await expect(page.getByRole("heading", { name: "КПП и вызывные" })).toBeVisible();
  });

  test("шапка: меню аккаунта с «Проекты», профилем и «Выйти»", async ({ page }) => {
    await page.goto(projectPath(ctx));
    await page.getByRole("button", { name: "Меню аккаунта" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Проекты" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "E2E Продюсер" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Выйти" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

test.describe("компьютер, 1280 px", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("меню проекта слева и шапка в строку — как раньше", async ({ page }) => {
    await page.goto(projectPath(ctx));
    await expect(page.getByRole("link", { name: "КПП", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Меню", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Меню аккаунта" })).toBeHidden();
    // Меню пользователя (кружок с инициалами и имя): «Профиль» и «Выйти».
    await page.getByRole("button", { name: "Меню пользователя" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Профиль" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Выйти" })).toBeVisible();
  });
});
