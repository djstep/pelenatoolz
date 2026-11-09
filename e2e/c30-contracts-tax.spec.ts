import { expect, test, type Page } from "@playwright/test";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Договоры и акты: в системе нет НДС, есть «Налог» (налог на доход исполнителя).
 * Подписи — «Налог», ставка по умолчанию не подставляется (раньше было 22%).
 * Файл только открывает экраны и окна, в базу ничего не пишет.
 */

const ctx = e2eContext();
test.use({ storageState: storageStatePath("producer") });

async function expectNoVat(page: Page) {
  await expect(page.locator("body")).not.toContainText("НДС");
}

test("договоры: в таблице и карточке нет «НДС»", async ({ page }) => {
  await page.goto(projectPath(ctx, "/counterparties/contracts"));
  await expect(page.getByRole("button", { name: "Добавить договор" })).toBeVisible();
  await expect(page.getByText("С налогом").first()).toBeVisible();
  await expectNoVat(page);

  test.skip(!ctx.contractId, "в сиде нет договора");
  await page.goto(projectPath(ctx, `/counterparties/contracts/${ctx.contractId}`));
  await expect(page.getByText("Сумма / с налогом")).toBeVisible();
  await expectNoVat(page);
});

test("новый договор: налог выключен, ставка пустая, подписи «Налог»", async ({ page }) => {
  await page.goto(projectPath(ctx, "/counterparties/contracts"));
  await page.getByRole("button", { name: "Добавить договор" }).click();
  const dialog = page.getByRole("dialog", { name: "Новый договор" });
  await expect(dialog.getByText("Сумма (без налога) *")).toBeVisible();
  const tax = dialog.getByRole("checkbox", { name: "С налогом" });
  await expect(tax).not.toBeChecked();
  await tax.check();
  await expect(dialog.locator("#vatRate")).toHaveValue("");
  await expect(dialog.getByText("Налог вручную")).toBeVisible();
  await expect(dialog.getByText("Итого с налогом")).toBeVisible();
  await expectNoVat(page);
});

test("акты: в таблице и окне нового акта нет «НДС»", async ({ page }) => {
  await page.goto(projectPath(ctx, "/counterparties/acts"));
  const add = page.getByRole("button", { name: "Добавить акт" }).first();
  await expect(add).toBeVisible();
  await expectNoVat(page);
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Новый акт" });
  await expect(dialog.getByText("Сумма (без налога) *")).toBeVisible();
  const tax = dialog.getByRole("checkbox", { name: "С налогом" });
  await expect(tax).not.toBeChecked();
  await tax.check();
  await expect(dialog.locator("#vatRate")).toHaveValue("");
  await expectNoVat(page);
});
