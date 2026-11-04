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
import {
  PERSONAL_DATA_CONSENT_REQUIRED,
  PERSONAL_DATA_POLICY_VERSION,
} from "../src/features/auth/lib/personal-data-consent";
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

test.describe("смена пароля в профиле", () => {
  const NEW_PASSWORD = "монтаж-среда-17-дубль";

  async function loggedIn(browser: Browser, email: string, ip: string, password = PASSWORD) {
    const opened = await openLogin(browser, ip);
    await submitLogin(opened.page, email, password);
    await expectLoggedIn(opened.page);
    await opened.page.goto("/ru/profile");
    return opened;
  }

  async function fillChange(page: LoginPage, current: string, next: string, repeat = next) {
    await page.locator("#current-password").fill(current);
    await page.locator("#new-password").fill(next);
    await page.locator("#new-password-repeat").fill(repeat);
    await page.getByTestId("change-password-form").locator('button[type="submit"]').click();
  }

  const formAlert = (page: LoginPage) => page.locator('[data-testid="change-password-form"] [role="alert"]');

  async function hasSession(page: LoginPage) {
    return Boolean((await (await page.request.get("/api/auth/session")).json())?.user);
  }

  test("успех: это устройство остаётся, второе выходит, старый пароль не подходит", async ({ browser }) => {
    const email = await createTmpUser("change");
    const here = await loggedIn(browser, email, IP_A);
    const other = await loggedIn(browser, email, IP_B);

    await fillChange(here.page, PASSWORD, NEW_PASSWORD);
    await expect(here.page.getByTestId("password-changed")).toBeVisible();
    await expect(here.page).toHaveURL(/\/profile/);
    await expect(here.page.locator("#current-password")).toHaveValue("");

    expect(await hasSession(here.page)).toBe(true);
    await here.page.reload();
    await expect(here.page).toHaveURL(/\/profile/);

    expect(await hasSession(other.page)).toBe(false);
    await other.page.goto("/ru/projects");
    await expect(other.page).toHaveURL(/\/login/);

    const fresh = await openLogin(browser, "203.0.113.30");
    await loginFails(fresh.page, email, PASSWORD, WRONG_LOGIN_MESSAGE);
    await submitLogin(fresh.page, email, NEW_PASSWORD);
    await expectLoggedIn(fresh.page);

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.sessionVersion).toBe(1);
    const audit = await db.auditLog.findMany({ where: { userId: user.id, entityType: "user_password" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].projectId).toBeNull();
    expect(JSON.stringify(audit[0])).not.toContain(NEW_PASSWORD);

    await Promise.all([here.context.close(), other.context.close(), fresh.context.close()]);
  });

  test("отказы: неверный текущий, повтор, слабый новый, совпадает с текущим", async ({ browser }) => {
    const email = await createTmpUser("change-refused");
    const { context, page } = await loggedIn(browser, email, IP_A);
    const hashBefore = (await db.user.findUniqueOrThrow({ where: { email } })).passwordHash;

    await fillChange(page, WRONG_PASSWORD, NEW_PASSWORD);
    await expect(formAlert(page)).toHaveText("Неверный текущий пароль");
    await expect(page.locator("#new-password")).toHaveValue(NEW_PASSWORD);

    await fillChange(page, PASSWORD, NEW_PASSWORD, "другой-пароль-дубль-5");
    await expect(formAlert(page)).toHaveText("Новый пароль и повтор не совпадают");

    await fillChange(page, PASSWORD, "QwertyUiop");
    await expect(formAlert(page)).toContainText("распространён");

    await fillChange(page, PASSWORD, email.split("@")[0]);
    await expect(formAlert(page)).toContainText("почтой");

    await fillChange(page, PASSWORD, PASSWORD);
    await expect(formAlert(page)).toHaveText("Новый пароль совпадает с текущим");

    const after = await db.user.findUniqueOrThrow({ where: { email } });
    expect(after.passwordHash).toBe(hashBefore);
    expect(after.sessionVersion).toBe(0);
    await context.close();
  });

  test("подбор текущего пароля ограничен: на 6-й раз отказ даже с верным", async ({ browser }) => {
    const email = await createTmpUser("change-limit");
    const { context, page } = await loggedIn(browser, email, IP_A);
    for (let i = 1; i <= LOGIN_RATE_LIMIT.limit; i += 1) {
      const answer = page.waitForResponse((res) => res.request().method() === "POST" && res.url().includes("/profile"));
      await fillChange(page, `${WRONG_PASSWORD}-${i}`, NEW_PASSWORD);
      await answer;
      await expect(formAlert(page)).toHaveText("Неверный текущий пароль");
    }
    await fillChange(page, PASSWORD, NEW_PASSWORD);
    await expect(formAlert(page)).toHaveText("Слишком много попыток. Попробуйте позже.");
    expect((await db.user.findUniqueOrThrow({ where: { email } })).sessionVersion).toBe(0);
    await context.close();
  });

  test("сессия гаснет сразу, как только номер в базе вырос", async ({ browser }) => {
    const email = await createTmpUser("change-version");
    const { context, page } = await loggedIn(browser, email, IP_A);
    expect(await hasSession(page)).toBe(true);
    await db.user.update({ where: { email }, data: { sessionVersion: { increment: 1 } } });
    expect(await hasSession(page)).toBe(false);
    await context.close();
  });
});

test.describe("требования к паролю", () => {
  const consentBox = (page: LoginPage) => page.locator('input[name="personalDataConsent"]');

  async function openRegister(browser: Browser, email: string, { consent = true } = {}) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/ru/register");
    await page.locator("#firstName").fill("Тест");
    await page.locator("#lastName").fill("Волна");
    await page.locator("#email").fill(email);
    if (consent) await consentBox(page).check({ force: true });
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

  test("без галочки форма не уходит", async ({ browser }) => {
    const email = tmpEmail("no-consent");
    const { context, page } = await openRegister(browser, email, { consent: false });
    await page.locator("#password").fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/register/);
    expect(await consentBox(page).evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("обойти галочку в браузере нельзя: отказ на сервере", async ({ browser }) => {
    const email = tmpEmail("no-consent-server");
    const { context, page } = await openRegister(browser, email, { consent: false });
    await page.locator("#password").fill(PASSWORD);
    await consentBox(page).evaluate((el: HTMLInputElement) => el.removeAttribute("required"));
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator('form [role="alert"]')).toHaveText(PERSONAL_DATA_CONSENT_REQUIRED);
    await expect(page).toHaveURL(/\/register/);
    expect(await db.user.count({ where: { email } })).toBe(0);
    await context.close();
  });

  test("с галочкой: в базе дата и редакция политики, в журнале запись о регистрации", async ({ browser }) => {
    const email = tmpEmail("consent");
    const { context, page } = await openRegister(browser, email);
    await page.locator("#password").fill(PASSWORD);
    const started = Date.now();
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/projects/);

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.personalDataConsentVersion).toBe(PERSONAL_DATA_POLICY_VERSION);
    expect(user.personalDataConsentAt).not.toBeNull();
    expect(user.personalDataConsentAt!.getTime()).toBeGreaterThan(started - 60_000);

    const audit = await db.auditLog.findMany({ where: { userId: user.id, action: "CREATE" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].projectId).toBeNull();
    expect(audit[0].summary).toContain("согласие");
    expect(JSON.stringify(audit[0])).not.toContain(email);
    await context.close();
  });
});

test.describe("политика обработки персональных данных", () => {
  test("открывается без входа, текст-заглушка с пометкой", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/ru/privacy");
    await expect(page).toHaveURL(/\/privacy/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Политика обработки персональных данных");
    await expect(page.getByTestId("privacy-stub")).toContainText("Нужен текст юриста");
    await context.close();
  });

  for (const path of ["/ru/login", "/ru/register"]) {
    test(`ссылка в подвале ${path}`, async ({ browser }) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(path);
      const [policy] = await Promise.all([
        context.waitForEvent("page"),
        page.getByTestId("privacy-footer-link").click(),
      ]);
      await expect(policy).toHaveURL(/\/ru\/privacy/);
      await expect(policy.getByTestId("privacy-stub")).toBeVisible();
      await context.close();
    });
  }

  test("ссылка в галочке открывает политику, заполненная форма остаётся", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/ru/register");
    await page.locator("#firstName").fill("Тест");
    const [policy] = await Promise.all([
      context.waitForEvent("page"),
      page.locator("form").getByRole("link", { name: "политику обработки персональных данных" }).click(),
    ]);
    await expect(policy).toHaveURL(/\/ru\/privacy/);
    await expect(page.locator("#firstName")).toHaveValue("Тест");
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
