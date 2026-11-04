import { expect, test } from "@playwright/test";
import { e2eDb } from "./helpers/db";

/**
 * Волна 6а: безопасность входа. Тесты работают на временных аккаунтах `e2e-tmp-*`
 * и удаляют их за собой; тестовые роли приёмки здесь не меняются.
 */

const db = e2eDb();
const TMP_PREFIX = "e2e-tmp-";

function tmpEmail(label: string) {
  return `${TMP_PREFIX}${label}-${Date.now()}@pelena.test`;
}

async function removeTmpUsers() {
  const users = await db.user.findMany({
    where: { email: { startsWith: TMP_PREFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

test.afterAll(async () => {
  await removeTmpUsers();
  await db.$disconnect();
});

test.describe("требования к паролю", () => {
  async function openRegister(browser: import("@playwright/test").Browser, email: string) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/ru/register");
    await page.locator("#firstName").fill("Тест");
    await page.locator("#lastName").fill("Волна");
    await page.locator("#email").fill(email);
    return { context, page };
  }

  test("частый пароль: подсказка, сервер не создаёт аккаунт, введённое остаётся", async ({ browser }) => {
    const email = tmpEmail("common");
    const { context, page } = await openRegister(browser, email);
    await page.locator("#password").fill("QwertyUiop");
    await expect(page.getByTestId("password-hint")).toContainText("распространён");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('form [role="alert"]')).toContainText("распространён");
    await expect(page).toHaveURL(/\/register/);
    await expect(page.locator("#email")).toHaveValue(email);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("пароль равен части почты до @: отказ", async ({ browser }) => {
    const email = tmpEmail("sameaslocal");
    const { context, page } = await openRegister(browser, email);
    await page.locator("#password").fill(email.split("@")[0]);
    await expect(page.getByTestId("password-hint")).toContainText("почтой");
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('form [role="alert"]')).toContainText("почтой");
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("короткий пароль: подсказка и форма не уходит", async ({ browser }) => {
    const email = tmpEmail("short");
    const { context, page } = await openRegister(browser, email);
    await page.locator("#password").fill("коротко9");
    await expect(page.getByTestId("password-hint")).toContainText("короткий");
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/register/);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("подходящий пароль: аккаунт создан, вход выполнен", async ({ browser }) => {
    const email = tmpEmail("good");
    const { context, page } = await openRegister(browser, email);
    await page.locator("#password").fill("сцена-вторник-48-дубль");
    await expect(page.getByTestId("password-hint")).toContainText("подходит");
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/projects/);
    expect(await db.user.count({ where: { email } })).toBe(1);
    await context.close();
  });
});

test.describe("экран «Забыли пароль»", () => {
  test("формы нет, текст про администратора, ссылка ко входу", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/ru/login");
    await page.getByRole("link", { name: "Забыли пароль?" }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByText("Обратитесь к администратору проекта")).toBeVisible();
    await expect(page.locator("#email")).toHaveCount(0);
    await expect(page.locator('form button[type="submit"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Вернуться ко входу" }).click();
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
