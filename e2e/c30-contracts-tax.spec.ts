import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Договоры и акты: в системе нет НДС, есть «Налог» (налог на доход исполнителя).
 * Подписи — «Налог», ставка по умолчанию не подставляется (раньше было 22%), списка
 * ставок нет — своя ставка или сумма налога. Последний тест пишет в базу свой акт и удаляет его.
 */

const ctx = e2eContext();
const db = e2eDb();

test.afterAll(async () => {
  await db.$disconnect();
});
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

test("акт с налогом суммой: при правке сумма на месте, повторное сохранение её не теряет", async ({ page }) => {
  test.skip(!ctx.contractId, "в сиде нет договора");
  const contract = await db.contract.findUniqueOrThrow({
    where: { id: ctx.contractId! },
    select: { companyId: true, counterpartyId: true, statusId: true },
  });
  const number = `E2E-налог-${Date.now()}`;
  const act = await db.certificate.create({
    data: {
      projectId: ctx.projectId,
      date: new Date("2026-11-09T00:00:00Z"),
      number,
      ...contract,
      amount: 1000,
      vatEnabled: true,
      vatRate: null,
      vatAmount: 60,
      amountWithVat: 1060,
    },
  });
  try {
    await page.goto(projectPath(ctx, "/counterparties/acts"));
    const row = page.locator("tr", { hasText: number });
    await row.getByRole("button", { name: "Изменить" }).click();
    const dialog = page.getByRole("dialog", { name: "Редактирование акта" });
    await expect(dialog.getByRole("checkbox", { name: "С налогом" })).toBeChecked();
    await expect(dialog.locator("#vatRate")).toHaveValue("");
    await expect(dialog.locator("#vatAmountManual")).toHaveValue("60");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toBeHidden();

    const saved = await db.certificate.findUniqueOrThrow({
      where: { id: act.id },
      select: { vatEnabled: true, vatRate: true, vatAmount: true, amountWithVat: true },
    });
    expect(saved.vatEnabled).toBe(true);
    expect(saved.vatRate).toBeNull();
    expect(Number(saved.vatAmount)).toBe(60);
    expect(Number(saved.amountWithVat)).toBe(1060);
  } finally {
    await db.certificate.delete({ where: { id: act.id } });
  }
});
