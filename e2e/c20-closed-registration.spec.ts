import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { REGISTRATION_CLOSED_MESSAGE } from "../src/features/auth/lib/registration-access";
import { E2E_PROJECT_NAME, E2E_REGISTRATION_EMAILS } from "./fixtures/data";
import { e2eDb } from "./helpers/db";

/**
 * Закрытая регистрация: только адреса из `REGISTRATION_ALLOWLIST` (задаётся в playwright.config.ts)
 * и люди с действующим приглашением. Проекты создают только адреса из списка.
 */

const db = e2eDb();
const TMP_PREFIX = "e2e-tmp-";
const FOREIGN_OWNER_EMAIL = "e2e-foreign-owner@pelena.test";
const PASSWORD = "сцена-вторник-48-дубль";
const createdInvites: string[] = [];

const tmpEmail = (label: string) => `${TMP_PREFIX}${label}-${Date.now()}@pelena.test`;

async function cleanup() {
  await db.projectInvite.deleteMany({ where: { id: { in: createdInvites } } });
  createdInvites.length = 0;
  const users = await db.user.findMany({
    where: { email: { startsWith: TMP_PREFIX } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await db.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await db.projectMembership.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

async function createInvite(data: { email?: string; expiresAt?: Date } = {}) {
  const project = await db.project.findFirstOrThrow({
    where: { name: E2E_PROJECT_NAME },
    select: { id: true, ownerUserId: true },
  });
  const role = await db.projectRoleDefinition.findFirstOrThrow({
    where: { projectId: project.id, name: "Наблюдатель" },
    select: { id: true },
  });
  const token = randomBytes(24).toString("base64url");
  const invite = await db.projectInvite.create({
    data: {
      projectId: project.id,
      roleId: role.id,
      token,
      email: data.email ?? null,
      expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000),
      createdById: project.ownerUserId!,
    },
    select: { id: true },
  });
  createdInvites.push(invite.id);
  return { token, projectId: project.id };
}

async function fillRegistration(page: Page, email: string) {
  await page.locator("#firstName").fill("Тест");
  await page.locator("#lastName").fill("Закрытая");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('input[name="personalDataConsent"]').check({ force: true });
  await page.locator('form button[type="submit"]').click();
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

test.describe("закрытая регистрация", () => {
  test("посторонняя почта: понятный отказ, аккаунта нет", async ({ browser }) => {
    const email = tmpEmail("stranger");
    const { context, page } = await newPage(browser);
    await page.goto("/ru/register");
    await expect(page.getByTestId("registration-closed")).toBeVisible();
    await fillRegistration(page, email);
    await expect(page.locator('form [role="alert"]')).toHaveText(REGISTRATION_CLOSED_MESSAGE);
    await expect(page).toHaveURL(/\/register/);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("посторонний не узнаёт, занят ли адрес", async ({ browser }) => {
    const { context, page } = await newPage(browser);
    await page.goto("/ru/register");
    await fillRegistration(page, FOREIGN_OWNER_EMAIL);
    await expect(page.locator('form [role="alert"]')).toHaveText(REGISTRATION_CLOSED_MESSAGE);
    await context.close();
  });

  test("адрес из списка регистрируется и может создать проект", async ({ browser }) => {
    const email = E2E_REGISTRATION_EMAILS.listed;
    const { context, page } = await newPage(browser);
    await page.goto("/ru/register");
    await fillRegistration(page, email);
    await page.waitForURL(/\/projects/);
    await expect(page.getByRole("link", { name: "Создать проект" }).first()).toBeVisible();
    await page.goto("/ru/projects/new");
    await expect(page).toHaveURL(/\/projects\/new/);
    await context.close();
  });

  test("приглашение: регистрация открыта, проекты создавать нельзя", async ({ browser }) => {
    const email = tmpEmail("invited");
    const { token, projectId } = await createInvite();
    const { context, page } = await newPage(browser);
    await page.goto(`/ru/invite/${token}`);
    await page.getByRole("link", { name: "Регистрация" }).click();
    await page.waitForURL(/\/register/);
    await expect(page.getByTestId("registration-closed")).toHaveCount(0);
    await fillRegistration(page, email);
    await page.waitForURL(new RegExp(`/invite/${token}`));
    await page.getByRole("button", { name: "Принять приглашение" }).click();
    await page.waitForURL(new RegExp(`/projects/${projectId}`));

    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    expect(await db.projectMembership.count({ where: { userId: user.id, projectId } })).toBe(1);

    await page.goto("/ru/projects/new");
    await page.waitForURL(/\/ru\/projects$/);
    await expect(page.getByRole("link", { name: "Создать проект" })).toHaveCount(0);
    await context.close();
  });

  test("приглашение на другую почту не открывает регистрацию", async ({ browser }) => {
    const email = tmpEmail("wrong-address");
    const { token } = await createInvite({ email: tmpEmail("addressee") });
    const { context, page } = await newPage(browser);
    await page.goto(`/ru/register?callbackUrl=${encodeURIComponent(`/ru/invite/${token}`)}`);
    await fillRegistration(page, email);
    await expect(page.locator('form [role="alert"]')).toHaveText(REGISTRATION_CLOSED_MESSAGE);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("просроченное приглашение не открывает регистрацию", async ({ browser }) => {
    const email = tmpEmail("expired");
    const { token } = await createInvite({ expiresAt: new Date(Date.now() - 60_000) });
    const { context, page } = await newPage(browser);
    await page.goto(`/ru/register?callbackUrl=${encodeURIComponent(`/ru/invite/${token}`)}`);
    await expect(page.getByTestId("registration-closed")).toBeVisible();
    await fillRegistration(page, email);
    await expect(page.locator('form [role="alert"]')).toHaveText(REGISTRATION_CLOSED_MESSAGE);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("подделанный адрес возврата не открывает регистрацию", async ({ browser }) => {
    const email = tmpEmail("forged");
    const { context, page } = await newPage(browser);
    await page.goto(`/ru/register?callbackUrl=${encodeURIComponent(`/ru/invite/${"x".repeat(32)}`)}`);
    await fillRegistration(page, email);
    await expect(page.locator('form [role="alert"]')).toHaveText(REGISTRATION_CLOSED_MESSAGE);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });
});
