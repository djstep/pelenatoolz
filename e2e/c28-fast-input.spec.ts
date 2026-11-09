import { expect, test } from "@playwright/test";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Быстрый ввод сразу после открытия окна: поля заполняются целиком, как у автозаполнения.
 * Раньше общее поле времени через кадр после фокуса выделяло свой текст и забирало фокус
 * обратно — ввод в следующее поле пропадал. Проверять на рабочей сборке: `E2E_PROD_BUILD=1`.
 */

const ctx = e2eContext();
const CALENDAR = projectPath(ctx, "/preproduction/calendar?view=month&date=2026-12-01");
const ROUNDS = 10;

test.use({ storageState: storageStatePath("producer") });

for (let round = 1; round <= ROUNDS; round += 1) {
  test(`окно события: время и «Место» не теряются, повтор ${round}`, async ({ page }) => {
    await page.goto(CALENDAR);
    await page.getByRole("button", { name: "+ Событие" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название *").fill("Проверка быстрого ввода");
    await dialog.getByLabel("Время начала").fill("1430");
    await dialog.getByLabel("Время окончания").fill("1600");
    await dialog.getByLabel("Место текстом").fill("Офис, переговорная");
    await dialog.getByLabel("Название *").click();
    await expect(dialog.getByLabel("Время начала")).toHaveValue("14:30");
    await expect(dialog.getByLabel("Время окончания")).toHaveValue("16:00");
    await expect(dialog.getByLabel("Место текстом")).toHaveValue("Офис, переговорная");
    await expect(dialog.getByLabel("Название *")).toHaveValue("Проверка быстрого ввода");
  });
}
