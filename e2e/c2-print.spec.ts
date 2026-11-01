import { expect, test, type Page } from "@playwright/test";
import { NAMES } from "./fixtures/data";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * (В) Каждая печатная выгрузка открывает окно сразу по клику и пишет в него HTML с сервера;
 * ошибка сервера — окно закрывается, сообщение на странице. Вызывной и его версии — в c1.
 */

const ctx = e2eContext();

test.use({ storageState: storageStatePath("producer") });

/** Нажать «экспорт» и дождаться окна с текстом (окно появилось по клику, «Готовим…» сменился листом). */
async function expectPrintWindow(page: Page, trigger: () => Promise<void>, text: string | RegExp) {
  const popupPromise = page.waitForEvent("popup");
  await trigger();
  const popup = await popupPromise;
  await expect(popup.getByText(text).first()).toBeVisible();
  await expect(popup.getByText("Готовим лист к печати")).toHaveCount(0);
  await popup.close();
}

test("каст-лист: PDF (печать) из карточки персонажа", async ({ page }) => {
  await page.goto(projectPath(ctx, `/characters/${ctx.characterId}`));
  await page.getByRole("button", { name: "Экспорт каст-листа" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("PDF (печать)").click();
  await expectPrintWindow(page, () => dialog.getByRole("button", { name: "Экспортировать" }).click(), NAMES.castingPerson.lastName);
});

test("сценарий персонажа: PDF (печать) — страница открывается", async ({ page }) => {
  await page.goto(projectPath(ctx, `/characters/${ctx.characterId}`));
  await page.getByRole("button", { name: "Сценарий персонажа" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("PDF (печать)").click();
  await expectPrintWindow(page, () => dialog.getByRole("button", { name: "Экспортировать" }).click(), NAMES.character);
});

for (const [item, title] of [
  ["Сценарий (Word/PDF)", "Настройки экспорта сценария"],
  ["Режиссёрский сценарий", "Настройки экспорта · режиссёрский сценарий"],
] as const) {
  test(`либретто: «${item}» в PDF`, async ({ page }) => {
    await page.goto(projectPath(ctx, "/libretto"));
    await page.getByRole("button", { name: "Экспорт", exact: true }).click();
    await page.getByRole("button", { name: item }).click();
    const dialog = page.getByRole("dialog", { name: title });
    await dialog.getByRole("radio", { name: "PDF", exact: true }).check();
    await expectPrintWindow(page, () => dialog.getByRole("button", { name: "Экспортировать" }).click(), /Утро в квартире|КВАРТИРА/i);
  });
}

test("редактор сценария: «PDF / печать»", async ({ page }) => {
  test.skip(!ctx.scriptVersionId, "в проекте нет версии сценария (npm run e2e:reset)");
  await page.goto(projectPath(ctx, `/screenplay/${ctx.scriptVersionId}`));
  await expectPrintWindow(page, () => page.getByRole("button", { name: "PDF / печать" }).click(), /Опаздываем/);
});

test("план проб без проб: окно открылось и закрылось, сообщение на странице", async ({ page }) => {
  await page.goto(projectPath(ctx, "/preproduction/auditions"));
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Экспорт плана проб" });
  await dialog.getByText("PDF (печать)").click();
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Экспортировать" }).click();
  const popup = await popupPromise;
  await popup.waitForEvent("close");
  await expect(page.getByText("Нет запланированных проб для экспорта").first()).toBeVisible();
});
