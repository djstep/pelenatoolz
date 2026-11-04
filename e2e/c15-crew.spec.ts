import { expect, test } from "@playwright/test";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 8: раздел «Команда». Шаг 1 — права в матрице ролей; экран и данные — в следующих шагах.
 */

const ctx = e2eContext();

test.describe("права «Команда» в матрице ролей", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("новая роль: просмотр команды отмечен, правка и контакты — нет", async ({ page }) => {
    await page.goto(projectPath(ctx, "/roles"));
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "+ Добавить роль" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("cell", { name: "Команда", exact: true })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "Команда: контакты", exact: true })).toBeVisible();

    const box = (name: string) => dialog.locator(`input[type=checkbox][name$="_${name}"]`);
    await expect(box("crew_read")).toBeChecked();
    await expect(box("crew_update")).not.toBeChecked();
    await expect(box("crew_contacts_access")).not.toBeChecked();
    // Создания и удаления у «Команды» нет: людей отправляют в архив.
    await expect(box("crew_create")).toHaveCount(0);
    await expect(box("crew_delete")).toHaveCount(0);
    await expect(box("crew_contacts_read")).toHaveCount(0);
  });
});
