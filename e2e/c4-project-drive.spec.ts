import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { E2E_ROLE_NAMES, E2E_ROLES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Диск проекта (шаг 4 волны дисков) — против заглушки дисков (`e2e/cloud-stub`), как `c3-drive`.
 * Нужен dev-сервер с адресами заглушки (конфигурация `dev-cloud-stub`) и `E2E_CLOUD_STUB_URL`.
 * Без `E2E_CLOUD_STUB_URL` тесты пропускаются: на сервере владельца — настоящий Google.
 *
 * Хранитель-не-владелец нужен для удаления: «E2E Без финансов» на время сценариев получает роль
 * «Продюсер» прямо в базе; в конце роль, участие и диск проекта возвращаются как были.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const SETTINGS = projectPath(ctx, "/settings");
const STUB_EMAIL = "stub-google@example.com";

type StubRequest = { provider: string | null; op: string | null };
type StubState = { google: { revokedTokens: string[] } };

async function stub<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STUB}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status, `заглушка ${path}`).toBe(200);
  return (await res.json()) as T;
}

const googleOps = async () =>
  (await stub<StubRequest[]>("/requests")).filter((r) => r.provider === "google").map((r) => r.op);

const membership = async (role: E2ERoleKey) =>
  db.projectMembership.findFirstOrThrow({
    where: { projectId: ctx.projectId, user: { email: E2E_ROLES[role].email } },
    select: { id: true, roleId: true, status: true },
  });

const roleId = async (name: string) =>
  (
    await db.projectRoleDefinition.findFirstOrThrow({
      where: { projectId: ctx.projectId, name },
      select: { id: true },
    })
  ).id;

/** Сменить роль участника прямо в базе (подготовка сценария, не проверка). */
async function setRole(role: E2ERoleKey, name: string) {
  const m = await membership(role);
  await db.projectMembership.update({ where: { id: m.id }, data: { roleId: await roleId(name) } });
}

const drive = () =>
  db.projectDrive.findUnique({
    where: { projectId: ctx.projectId },
    select: {
      id: true,
      status: true,
      keeperMembershipId: true,
      accessToken: true,
      refreshToken: true,
      scopes: true,
      detachReason: true,
    },
  });

async function lastDriveAudit() {
  return db.auditLog.findFirst({
    where: { projectId: ctx.projectId, entityType: "project_drive" },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, summary: true, changes: true },
  });
}

async function openAs(browser: Browser, role: E2ERoleKey) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

/** «Настройки проекта» → «Подключить Google Диск» → окно → Google (заглушка сразу возвращает код). */
async function connectProjectDrive(page: Page) {
  await page.goto(SETTINGS);
  const section = page.getByTestId("project-drive");
  await section.getByRole("button", { name: "Подключить Google Диск" }).click();
  const dialog = page.getByRole("dialog", { name: "Подключить диск проекта" });
  await expect(dialog.getByTestId("project-drive-hint")).toHaveText(
    "Лучше подключить служебный аккаунт компании: файлы остаются в аккаунте того, кто подключил",
  );
  await dialog.getByRole("button", { name: "Перейти в Google" }).click();
  await expect(page.getByTestId("cloud-oauth-notice")).toBeVisible();
}

/** Личный Google Диск через «Профиль» — тот же аккаунт заглушки, что и у диска проекта. */
async function connectPersonalGoogle(browser: Browser, role: E2ERoleKey) {
  const { context, page } = await openAs(browser, role);
  await page.goto("/ru/profile");
  await page
    .getByTestId("cloud-connection-GOOGLE_DRIVE")
    .getByRole("button", { name: /Подключить|Переподключить/ })
    .click();
  await expect(page.getByTestId("cloud-oauth-notice")).toContainText("подключён");
  await context.close();
}

/** Начать подключение диска проекта запросом формы; вернуть адрес, куда отправил сервер. */
async function startProjectConnect(page: Page) {
  const res = await page.request.post("/api/cloud/google/authorize", {
    form: { purpose: "project", projectId: ctx.projectId, returnTo: SETTINGS },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(303);
  return res.headers()["location"] ?? "";
}

/** Выбрать роль в строке участника (свой список `Select`, не нативный). */
async function pickRole(page: Page, row: Locator, roleName: string) {
  await row.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole("option", { name: roleName, exact: true }).click();
}

const memberRow = (page: Page, role: E2ERoleKey) =>
  page.locator("tr").filter({ hasText: E2E_ROLES[role].email });

const e2eEmails = Object.values(E2E_ROLES).map((r) => r.email);
let nofinBefore: { roleId: string; status: string };
let nocallsheetRoleId: string;

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — диск проекта проверяется только на заглушке");
test.use({ storageState: storageStatePath("producer") });

test.beforeAll(async () => {
  await stub("/reset", {});
  // С чистого листа: диск проекта и личные подключения e2e-пользователей (правило отзыва смотрит на них).
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: e2eEmails } } } });
  const nofin = await membership("nofin");
  nofinBefore = { roleId: nofin.roleId, status: nofin.status };
  nocallsheetRoleId = (await membership("nocallsheet")).roleId;
});

test.afterAll(async () => {
  if (!STUB) return;
  const nofin = await membership("nofin");
  await db.projectMembership.update({
    where: { id: nofin.id },
    data: { roleId: nofinBefore.roleId, status: nofinBefore.status as "ACTIVE" },
  });
  const nocallsheet = await membership("nocallsheet");
  await db.projectMembership.update({ where: { id: nocallsheet.id }, data: { roleId: nocallsheetRoleId } });
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: e2eEmails } } } });
  await db.$disconnect();
});

test("не продюсер: authorize отказывает, к Google не идём", async ({ browser }) => {
  const { context, page } = await openAs(browser, "nofin");
  const location = await startProjectConnect(page);
  expect(location).toContain("cloud_error=forbidden");
  expect(location).not.toContain("/google/");
  expect(await googleOps()).not.toContain("authorize");
  // Раздела «Диск проекта» у не продюсера нет.
  await page.goto(SETTINGS);
  await expect(page.getByTestId("project-drive")).toHaveCount(0);
  await context.close();
  expect(await drive()).toBeNull();
});

test("callback проверяет права заново: понизили, пока был в окне Google, — отказ, диск не сохранён", async ({ browser }) => {
  await setRole("nofin", "Продюсер");
  const { context, page } = await openAs(browser, "nofin");
  const toGoogle = await startProjectConnect(page);
  expect(toGoogle).toContain("/google/o/oauth2/v2/auth");
  // Окно согласия заглушки сразу отдаёт адрес возврата с кодом.
  const consent = await fetch(toGoogle, { redirect: "manual" });
  const callback = consent.headers.get("location") ?? "";
  expect(callback).toContain("/api/cloud/google/callback");

  await setRole("nofin", E2E_ROLE_NAMES.nofin);
  const res = await page.request.get(callback, { maxRedirects: 0 });
  expect(res.status()).toBeGreaterThanOrEqual(300);
  expect(res.headers()["location"] ?? "").toContain("cloud_error=forbidden");
  await context.close();

  expect(await drive()).toBeNull();
  // Код не обменивался на токены.
  expect(await googleOps()).not.toContain("token-code");
});

test("владелец-продюсер подключает диск проекта: хранитель, почта, когда; токены зашифрованы; журнал", async ({ page }) => {
  await connectProjectDrive(page);
  await expect(page.getByTestId("cloud-oauth-notice")).toHaveText("Диск проекта подключён");
  await expect(page.getByTestId("project-drive-account")).toContainText(STUB_EMAIL);
  await expect(page.getByTestId("project-drive-keeper")).toHaveText(E2E_ROLES.producer.name);
  await expect(page.getByTestId("project-drive")).toContainText("Подключён");

  const row = await drive();
  expect(row?.status).toBe("ACTIVE");
  expect(row?.keeperMembershipId).toBe((await membership("producer")).id);
  expect(row?.scopes).toContain("https://www.googleapis.com/auth/drive.file");
  // В базе — шифр, не токен заглушки.
  expect(row?.accessToken ?? "").not.toMatch(/^g-at-/);
  expect(row?.refreshToken ?? "").not.toMatch(/^g-rt-/);

  const audit = await lastDriveAudit();
  expect(audit?.summary).toContain("Подключён диск проекта");
  expect(audit?.entityId).toBe(row?.id);
  expect(JSON.stringify(audit)).not.toContain("@");
});

test("смена роли не-хранителя диск не трогает", async ({ page }) => {
  await page.goto(projectPath(ctx, "/members"));
  const row = memberRow(page, "nocallsheet");
  await pickRole(page, row, E2E_ROLE_NAMES.nofin);
  await expect(page.getByText("Роль обновлена")).toBeVisible();
  // Окна с предупреждением о диске не было — роль сменилась сразу.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await drive())?.status).toBe("ACTIVE");
  await setRole("nocallsheet", E2E_ROLE_NAMES.nocallsheet);
});

test("владелец отключает диск: аккаунт больше нигде не подключён — токен отозван у Google", async ({ page }) => {
  await page.goto(SETTINGS);
  await page.getByTestId("project-drive").getByRole("button", { name: "Отключить" }).click();
  const dialog = page.getByRole("dialog", { name: "Отключить диск проекта?" });
  await dialog.getByRole("button", { name: "Отключить" }).click();
  await expect(page.getByText("Диск проекта отключён", { exact: true })).toBeVisible();

  const row = await drive();
  expect(row?.status).toBe("DETACHED");
  expect(row?.accessToken).toBeNull();
  expect(row?.detachReason).toBe("disconnected");
  expect((await stub<StubState>("/state")).google.revokedTokens).toHaveLength(1);
  // Отключили руками — плашки «подключите новый» нет.
  await page.goto(projectPath(ctx));
  await expect(page.getByTestId("project-drive-alert")).toHaveCount(0);
});

test("удаление хранителя: предупреждение в окнах, диск отключён, токен не отозван (аккаунт ещё подключён), плашка", async ({ browser, page }) => {
  // Хранитель — продюсер, не владелец; у него же подключён личный Google того же аккаунта.
  await setRole("nofin", "Продюсер");
  await connectPersonalGoogle(browser, "nofin");
  const keeper = await openAs(browser, "nofin");
  await connectProjectDrive(keeper.page);
  await expect(keeper.page.getByTestId("cloud-oauth-notice")).toHaveText("Диск проекта подключён");
  await expect(keeper.page.getByTestId("project-drive-keeper")).toHaveText(E2E_ROLES.nofin.name);
  await keeper.context.close();
  expect((await drive())?.keeperMembershipId).toBe((await membership("nofin")).id);
  const revokedBefore = (await stub<StubState>("/state")).google.revokedTokens.length;

  await page.goto(projectPath(ctx, "/members"));
  const row = memberRow(page, "nofin");
  await expect(row.getByText("Хранитель диска")).toBeVisible();

  // Смена роли хранителя на не продюсерскую — окно с предупреждением; «Отмена» — роль и диск прежние.
  await pickRole(page, row, E2E_ROLE_NAMES.nofin);
  const roleDialog = page.getByRole("dialog", { name: /Сменить роль/ });
  await expect(roleDialog).toContainText(
    "Это хранитель диска проекта — диск отключится, новые папки и ссылки придётся создавать заново",
  );
  await roleDialog.getByRole("button", { name: "Отмена" }).click();
  await expect(row.locator('button[aria-haspopup="listbox"]')).toHaveText(/Продюсер/);
  expect((await drive())?.status).toBe("ACTIVE");

  // Удаление — то же предупреждение; подтверждаем.
  await row.getByRole("button", { name: "Удалить" }).click();
  const removeDialog = page.getByRole("dialog", { name: /Удалить участника/ });
  await expect(removeDialog).toContainText(
    "Это хранитель диска проекта — диск отключится, новые папки и ссылки придётся создавать заново",
  );
  await removeDialog.getByRole("button", { name: "Удалить" }).click();
  await expect(removeDialog).toHaveCount(0);

  const detached = await drive();
  expect(detached?.status).toBe("DETACHED");
  expect(detached?.detachReason).toBe("keeper_left");
  expect(detached?.accessToken).toBeNull();
  expect(detached?.refreshToken).toBeNull();
  const audit = await lastDriveAudit();
  expect(audit?.summary).toBe(`Диск проекта отключён: хранитель «${E2E_ROLES.nofin.name}» больше не продюсер`);
  expect(JSON.stringify(audit)).not.toContain("@");

  // Тот же аккаунт Google подключён личным диском — у Google не отзываем (иначе сломали бы и его).
  expect((await stub<StubState>("/state")).google.revokedTokens).toHaveLength(revokedBefore);
  const personal = await db.cloudConnection.findFirstOrThrow({
    where: { provider: "GOOGLE_DRIVE", user: { email: E2E_ROLES.nofin.email } },
    select: { needsReconnectAt: true },
  });
  expect(personal.needsReconnectAt).toBeNull();

  // Плашка продюсерам на страницах проекта и в настройках; у роли без продюсера — нет.
  await page.goto(projectPath(ctx));
  await expect(page.getByTestId("project-drive-alert")).toContainText("Диск проекта отключён — подключите новый");
  await page.goto(SETTINGS);
  await expect(page.getByTestId("project-drive-alert")).toBeVisible();
  await expect(page.getByTestId("project-drive").getByRole("button", { name: "Подключить Google Диск" })).toBeVisible();
  const other = await openAs(browser, "nocallsheet");
  await other.page.goto(projectPath(ctx));
  await expect(other.page.getByRole("heading").first()).toBeVisible();
  await expect(other.page.getByTestId("project-drive-alert")).toHaveCount(0);
  await other.context.close();
});
