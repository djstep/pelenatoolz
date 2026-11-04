import { expect, test, type Browser } from "@playwright/test";
import bcrypt from "bcryptjs";
import {
  LOGIN_BLOCKED_MESSAGE,
  LOGIN_EMAIL_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  loginLimitEmailKey,
  loginLimitEmailPrefix,
  loginLimitKey,
} from "../src/features/auth/lib/login-limit";
import { checkRateLimit, resetRateLimit } from "../src/shared/lib/rate-limit";
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

const PASSWORD = "сцена-вторник-48-дубль";
const WRONG_PASSWORD = "неверный-пароль-дубль-2";
const WRONG_LOGIN_MESSAGE = "Неверный email или пароль";
const IP_A = "203.0.113.10";
const IP_B = "203.0.113.20";

/** Временный пользователь сразу в базе. Низкая стоимость хеша только для скорости теста. */
async function createTmpUser(label: string) {
  const email = tmpEmail(label);
  await db.user.create({
    data: { email, name: "Тест Волна", passwordHash: await bcrypt.hash(PASSWORD, 4) },
  });
  return email;
}

/** Страница входа с «посетителем» с заданного IP. */
async function openLogin(browser: Browser, ip: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const page = await context.newPage();
  await page.goto("/ru/login");
  return { context, page };
}

type LoginPage = Awaited<ReturnType<typeof openLogin>>["page"];

async function submitLogin(page: LoginPage, email: string, password: string) {
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function expectRefused(page: LoginPage, message: string) {
  await expect(page.locator('form [role="alert"]')).toHaveText(message);
  await expect(page).toHaveURL(/\/login/);
}

async function loginFails(page: LoginPage, email: string, password: string, message: string) {
  // Сообщение прошлой попытки на экране: дожидаемся, что новая дошла до сервера и вернулась.
  const answer = page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/login"));
  await submitLogin(page, email, password);
  await answer;
  await expectRefused(page, message);
}

async function failFiveTimes(page: LoginPage, email: string) {
  for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i += 1) {
    await loginFails(page, email, WRONG_PASSWORD, WRONG_LOGIN_MESSAGE);
  }
}

/** Вход удался: новая страница не «вход», и сервер считает посетителя вошедшим. */
async function expectLoggedIn(page: LoginPage) {
  await page.waitForURL(/\/projects/);
  const session = await page.request.get("/api/auth/session");
  expect((await session.json()).user).toBeTruthy();
}

test.afterAll(async () => {
  await removeTmpUsers();
  await db.rateLimitCounter.deleteMany({ where: { key: { startsWith: "test:" } } });
  await db.$disconnect();
});

test.describe("ограничение попыток входа", () => {
  test("5 неудач — блок: на 6-й раз отказ даже с верным паролем", async ({ browser }) => {
    const email = await createTmpUser("block");
    const { context, page } = await openLogin(browser, IP_A);
    await failFiveTimes(page, email);
    await loginFails(page, email, PASSWORD, LOGIN_BLOCKED_MESSAGE);
    await page.goto("/ru/projects");
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("5-я попытка ещё проверяется: верный пароль проходит", async ({ browser }) => {
    const email = await createTmpUser("fifth");
    const { context, page } = await openLogin(browser, IP_A);
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit - 1; i += 1) {
      await loginFails(page, email, WRONG_PASSWORD, WRONG_LOGIN_MESSAGE);
    }
    await submitLogin(page, email, PASSWORD);
    await expectLoggedIn(page);
    expect(await db.rateLimitCounter.count({ where: { key: loginLimitKey(email, IP_A) } })).toBe(0);
    await context.close();
  });

  test("блок пары не мешает той же почте с другого IP и другой почте с того же IP", async ({ browser }) => {
    const blocked = await createTmpUser("pair");
    const other = await createTmpUser("pair-other");
    const first = await openLogin(browser, IP_A);
    await failFiveTimes(first.page, blocked);
    await loginFails(first.page, blocked, PASSWORD, LOGIN_BLOCKED_MESSAGE);

    const sameEmail = await openLogin(browser, IP_B);
    await submitLogin(sameEmail.page, blocked, PASSWORD);
    await expectLoggedIn(sameEmail.page);

    const sameIp = await openLogin(browser, IP_A);
    await submitLogin(sameIp.page, other, PASSWORD);
    await expectLoggedIn(sameIp.page);

    // Чужой успех блок пары не снял.
    expect(await db.rateLimitCounter.count({ where: { key: loginLimitKey(blocked, IP_A) } })).toBe(1);
    await loginFails(first.page, blocked, PASSWORD, LOGIN_BLOCKED_MESSAGE);
    await Promise.all([first.context.close(), sameEmail.context.close(), sameIp.context.close()]);
  });

  test("после 15 минут вход снова работает (время подменено в базе)", async ({ browser }) => {
    const email = await createTmpUser("expired");
    const { context, page } = await openLogin(browser, IP_A);
    await failFiveTimes(page, email);
    await loginFails(page, email, PASSWORD, LOGIN_BLOCKED_MESSAGE);

    const key = loginLimitKey(email, IP_A);
    const counter = await db.rateLimitCounter.findUniqueOrThrow({ where: { key } });
    expect(counter.blockedUntil).not.toBeNull();
    const untilMs = counter.blockedUntil!.getTime() - counter.windowStart.getTime();
    expect(untilMs).toBeGreaterThan(LOGIN_RATE_LIMIT.blockMs - 60_000);
    expect(untilMs).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.blockMs + 60_000);

    await db.rateLimitCounter.update({
      where: { key },
      data: { blockedUntil: new Date(Date.now() - 1000), windowStart: new Date(Date.now() - 30 * 60_000) },
    });
    await submitLogin(page, email, PASSWORD);
    await expectLoggedIn(page);
    expect(await db.rateLimitCounter.count({ where: { key } })).toBe(0);
    await context.close();
  });

  test("успешный вход обнуляет счётчик", async ({ browser }) => {
    const email = await createTmpUser("reset");
    const first = await openLogin(browser, IP_A);
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit - 1; i += 1) {
      await loginFails(first.page, email, WRONG_PASSWORD, WRONG_LOGIN_MESSAGE);
    }
    await submitLogin(first.page, email, PASSWORD);
    await expectLoggedIn(first.page);

    const second = await openLogin(browser, IP_A);
    await failFiveTimes(second.page, email);
    await Promise.all([first.context.close(), second.context.close()]);
  });

  test("несуществующая почта блокируется так же: наличие адреса не выдаётся", async ({ browser }) => {
    const email = tmpEmail("nobody");
    const { context, page } = await openLogin(browser, IP_A);
    await failFiveTimes(page, email);
    await loginFails(page, email, WRONG_PASSWORD, LOGIN_BLOCKED_MESSAGE);
    await db.rateLimitCounter.deleteMany({ where: { key: { startsWith: loginLimitEmailPrefix(email) } } });
    await context.close();
  });

  test("прямой запрос к /api/auth не обходит блок", async ({ browser }) => {
    const email = await createTmpUser("direct");
    const { context, page } = await openLogin(browser, IP_A);
    await failFiveTimes(page, email);

    const directLogin = async (target: LoginPage) => {
      const { csrfToken } = await (await target.request.get("/api/auth/csrf")).json();
      await target.request.post("/api/auth/callback/credentials", {
        form: { csrfToken, email, password: PASSWORD, redirect: "false", callbackUrl: "/ru/projects" },
        maxRedirects: 0,
      });
      return (await target.request.get("/api/auth/session")).json();
    };

    expect((await directLogin(page))?.user).toBeFalsy();

    // Контроль: такой же запрос с другого IP входит, значит отказ выше дал именно блок.
    const other = await openLogin(browser, IP_B);
    expect((await directLogin(other.page))?.user).toBeTruthy();
    await Promise.all([context.close(), other.context.close()]);
  });

  test.describe("лимит на почту с любых IP", () => {
    /** Неудачи с разных адресов: счётчик пары у каждого IP остаётся на единице. */
    async function failFromManyIps(page: LoginPage, email: string) {
      for (let i = 0; i < LOGIN_EMAIL_RATE_LIMIT.limit; i += 1) {
        await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${i + 1}` });
        await loginFails(page, email, WRONG_PASSWORD, WRONG_LOGIN_MESSAGE);
      }
    }

    test("20 неудач с разных IP — 21-я с нового IP отказ; через час вход снова работает", async ({ browser }) => {
      const email = await createTmpUser("many-ips");
      const { context, page } = await openLogin(browser, IP_A);
      await failFromManyIps(page, email);

      await page.setExtraHTTPHeaders({ "x-forwarded-for": "198.51.100.200" });
      await loginFails(page, email, PASSWORD, LOGIN_BLOCKED_MESSAGE);

      const key = loginLimitEmailKey(email);
      const counter = await db.rateLimitCounter.findUniqueOrThrow({ where: { key } });
      expect(counter.blockedUntil).not.toBeNull();

      const hourAgo = new Date(Date.now() - LOGIN_EMAIL_RATE_LIMIT.windowMs - 1000);
      await db.rateLimitCounter.update({
        where: { key },
        data: { blockedUntil: hourAgo, windowStart: hourAgo },
      });
      await submitLogin(page, email, PASSWORD);
      await expectLoggedIn(page);
      expect(await db.rateLimitCounter.count({ where: { key } })).toBe(0);
      await context.close();
    });

    test("блок почты не мешает другой почте с тех же IP", async ({ browser }) => {
      const email = await createTmpUser("many-ips-blocked");
      const other = await createTmpUser("many-ips-other");
      const { context, page } = await openLogin(browser, IP_A);
      await failFromManyIps(page, email);
      await loginFails(page, email, PASSWORD, LOGIN_BLOCKED_MESSAGE);

      await submitLogin(page, other, PASSWORD);
      await expectLoggedIn(page);
      await context.close();
    });

    test("один IP почту не блокирует: после блока пары счётчик почты не растёт", async ({ browser }) => {
      const email = await createTmpUser("one-ip");
      const { context, page } = await openLogin(browser, IP_A);
      await failFiveTimes(page, email);
      for (let i = 0; i < 3; i += 1) {
        await loginFails(page, email, WRONG_PASSWORD, LOGIN_BLOCKED_MESSAGE);
      }
      const counter = await db.rateLimitCounter.findUniqueOrThrow({ where: { key: loginLimitEmailKey(email) } });
      expect(counter.count).toBe(LOGIN_RATE_LIMIT.limit);
      await context.close();
    });
  });

  test("одновременные попытки: сверх лимита не проходит ни одна", async () => {
    const key = `test:${Date.now()}`;
    const answers = await Promise.all(
      Array.from({ length: 20 }, () => checkRateLimit(key, LOGIN_RATE_LIMIT)),
    );
    expect(answers.filter((a) => a.allowed)).toHaveLength(LOGIN_RATE_LIMIT.limit);
    await resetRateLimit(key);
  });

  test("в счётчике нет почты и IP в открытом виде", async () => {
    const email = tmpEmail("hashed");
    const key = loginLimitKey(email, IP_A);
    await checkRateLimit(key, LOGIN_RATE_LIMIT);
    const rows = await db.rateLimitCounter.findMany({
      where: { OR: [{ key: { contains: "e2e-tmp" } }, { key: { contains: IP_A } }] },
    });
    expect(rows).toHaveLength(0);
    await resetRateLimit(key);
  });
});

test.describe("требования к паролю", () => {
  async function openRegister(browser: Browser, email: string) {
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
    await page.locator("#password").fill(PASSWORD);
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
