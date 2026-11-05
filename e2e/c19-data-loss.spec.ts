import { expect, test, type Page } from "@playwright/test";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Потеря работы пользователя (ветка fix/data-loss): обрыв связи в окнах экспорта.
 * Обрыв — отказ запросов к серверным действиям: окно не зависает, страница не падает,
 * после возврата связи экспорт работает.
 */

const ctx = e2eContext();
const CREW_PATH = projectPath(ctx, "/crew");
const SCHEDULE_PATH = projectPath(ctx, "/schedule");
const NO_LINK = "нет связи с сервером";

/** Все запросы к серверным действиям обрываются, пока не вызван возврат связи. */
async function cutActions(page: Page) {
  const handler = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    if (route.request().headers()["next-action"]) await route.abort("connectionfailed");
    else await route.fallback();
  };
  await page.route("**/*", handler);
  return () => page.unroute("**/*", handler);
}

async function openPage(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
}

test.describe("обрыв связи в окнах экспорта", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("Команда: раскладка не загрузилась — окно работает с колонками по умолчанию", async ({ page }) => {
    await openPage(page, CREW_PATH);
    const restore = await cutActions(page);
    await page.getByRole("menuitem", { name: "Excel", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(page.getByText(NO_LINK).first()).toBeVisible();
    await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);
    const run = dialog.getByRole("button", { name: "Экспортировать Excel" });
    await expect(run).toBeEnabled();

    await restore();
    const download = page.waitForEvent("download");
    await run.click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("Команда: обрыв при выгрузке — страница цела, повтор срабатывает", async ({ page }) => {
    await openPage(page, CREW_PATH);
    const layout = page.waitForResponse((res) => Boolean(res.request().headers()["next-action"]));
    await page.getByRole("menuitem", { name: "Excel", exact: true }).click();
    await layout;
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);

    const restore = await cutActions(page);
    const run = dialog.getByRole("button", { name: "Экспортировать Excel" });
    await run.click();
    await expect(page.getByText(NO_LINK).first()).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(run).toBeEnabled();

    await restore();
    const download = page.waitForEvent("download");
    await run.click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("КПП: данные не загрузились — окно не зависает, выгрузка недоступна", async ({ page }) => {
    await openPage(page, SCHEDULE_PATH);
    const restore = await cutActions(page);
    await page.getByText("Краткий КПП", { exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(page.getByText(NO_LINK).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: /Экспортировать/ })).toBeDisabled();
    await restore();
  });
});
