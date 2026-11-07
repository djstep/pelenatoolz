import { expect, test, type Browser } from "@playwright/test";
import { E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";
import { PERSONAL_DATA_POLICY_VERSION } from "../src/features/auth/lib/personal-data-consent";

/** Опубликованная политика и принятие её редакции при следующем входе. */

const ctx = e2eContext();
const db = e2eDb();
const EMAIL = E2E_ROLES.nocallsheet.email;

test.describe.configure({ mode: "serial" });

async function setConsent(version: string | null) {
  await db.user.update({
    where: { email: EMAIL },
    data: { personalDataConsentVersion: version },
  });
}

async function consentAudits() {
  const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  return db.auditLog.count({
    where: { userId: user.id, summary: "Принята редакция политики обработки персональных данных" },
  });
}

async function signedIn(browser: Browser) {
  const context = await browser.newContext({ storageState: storageStatePath("nocallsheet") });
  return context.newPage();
}

test.afterAll(async () => {
  await setConsent(PERSONAL_DATA_POLICY_VERSION);
});

test("политика открывается без входа, текст опубликован, заглушки нет", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/ru/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Политика конфиденциальности и обработки персональных данных.",
  );
  const text = page.getByTestId("privacy-policy");
  await expect(text).toContainText("Редакция от 07.11.2026");
  await expect(text).toContainText("Актуальная версия Политики в свободном доступе");
  await expect(page.getByRole("heading", { level: 2, name: "9. Заключительные положения" })).toBeVisible();
  await expect(page.getByText("Нужен текст юриста")).toHaveCount(0);
});

test("адрес из текста политики открывает её", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  for (const path of ["/privacy", "/privacy/"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/ru\/privacy$/);
    await expect(page.getByTestId("privacy-policy")).toBeVisible();
  }
});

for (const version of ["draft-2026-11-04", null]) {
  test(`согласие «${version ?? "нет"}»: при входе просим принять один раз`, async ({ browser }) => {
    await setConsent(version);
    const auditBefore = await consentAudits();
    const page = await signedIn(browser);

    for (const path of [projectPath(ctx), "/ru/projects", "/ru/profile"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/ru\/consent$/);
    }

    // Без отметки браузер форму не отправит.
    await page.getByRole("button", { name: "Принять" }).click();
    await expect(page).toHaveURL(/\/ru\/consent$/);

    await page.locator('input[name="personalDataConsent"]').check({ force: true });
    await page.getByRole("button", { name: "Принять" }).click();
    await expect(page).toHaveURL(/\/ru\/projects$/);

    const user = await db.user.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { id: true, personalDataConsentVersion: true, personalDataConsentAt: true },
    });
    expect(user.personalDataConsentVersion).toBe(PERSONAL_DATA_POLICY_VERSION);
    expect(user.personalDataConsentAt).not.toBeNull();

    // Второй раз не спрашиваем, страница согласия сама уводит в проекты.
    await page.goto(projectPath(ctx));
    await expect(page).toHaveURL(new RegExp(`${projectPath(ctx)}$`));
    await page.goto("/ru/consent");
    await expect(page).toHaveURL(/\/ru\/projects$/);

    expect(await consentAudits()).toBe(auditBefore + 1);
  });
}

test("актуальное согласие: страница не показывается", async ({ browser }) => {
  await setConsent(PERSONAL_DATA_POLICY_VERSION);
  const page = await signedIn(browser);
  await page.goto("/ru/projects");
  await expect(page).toHaveURL(/\/ru\/projects$/);
});
