import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ROLE_NAMES, E2E_ROLES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, stateShot, storageStatePath } from "./helpers/session";

/**
 * Папки и доступы на диске проекта (шаг 5 волны дисков) — против заглушки дисков, как `c3`/`c4`.
 * Нужен dev-сервер с адресами заглушки (конфигурация `dev-cloud-stub`) и `E2E_CLOUD_STUB_URL`.
 * Папки создаёт настоящая `ensureProjectDriveFolder` (`e2e/helpers/ensure-drive-folder.ts`) — так
 * её вызовет выгрузка шага 6. Пересчёт после действий идёт через `after()` — ждём его по заглушке.
 *
 * Люди: «E2E Продюсер» (владелец, хранитель), «E2E Без финансов» (видит вызывные),
 * «E2E Без вызывных» (не видит). Аккаунт диска — `stub-google@example.com`.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const SETTINGS = projectPath(ctx, "/settings");
const MANUAL_EMAIL = "friend-of-keeper@gmail.com";
const NOFIN_GOOGLE = "e2e.nofin.google@gmail.com";

type StubFile = { id: string; name: string; mimeType: string; parents: string[] };
type StubPermission = {
  id: string;
  fileId: string;
  role: string;
  emailAddress: string;
  sendNotificationEmail: boolean;
  manual?: boolean;
};
type StubState = { google: { files: StubFile[]; permissions: StubPermission[] } };
type StubRequest = { provider: string | null; op: string | null; status: number };

async function stub<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STUB}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status, `заглушка ${path}`).toBe(200);
  return (await res.json()) as T;
}

const email = (role: E2ERoleKey) => E2E_ROLES[role].email;

/** Почты с доступом к папке у Google (без владельца), по алфавиту. */
async function emailsOf(folderId: string, opts: { manual?: boolean } = {}) {
  const { google } = await stub<StubState>("/state");
  return google.permissions
    .filter((p) => p.fileId === folderId && (opts.manual === undefined || !!p.manual === opts.manual))
    .map((p) => p.emailAddress.toLowerCase())
    .sort();
}

/** Ждать, пока доступы папки (выданные системой) станут такими. Пересчёт идёт после ответа. */
async function expectSystemGrants(folderId: string, emails: string[]) {
  await expect
    .poll(() => emailsOf(folderId, { manual: false }), { timeout: 20_000 })
    .toEqual([...emails].map((e) => e.toLowerCase()).sort());
}

const membership = async (role: E2ERoleKey) =>
  db.projectMembership.findFirstOrThrow({
    where: { projectId: ctx.projectId, user: { email: email(role) } },
    select: { id: true, roleId: true, status: true, userId: true },
  });

async function openAs(browser: Browser, role: E2ERoleKey) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

/** Создать папку настоящей `ensureProjectDriveFolder` (отдельный процесс, как сервер). */
function ensureFolder(actorUserId: string, target: "common" | string) {
  const out = execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "e2e/helpers/ensure-drive-folder.ts", ctx.projectId, actorUserId, target],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development", CLOUD_STUB_GOOGLE_URL: `${STUB}/google` },
      timeout: 60_000,
    },
  );
  return JSON.parse(out.trim().split("\n").pop() ?? "{}") as {
    folderId: string;
    externalId: string;
    outcome: string;
  };
}

async function pickRole(page: Page, roleKey: E2ERoleKey, roleName: string) {
  await page.goto(projectPath(ctx, "/members"));
  const row = page.locator("tr").filter({ hasText: email(roleKey) });
  await row.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole("option", { name: roleName, exact: true }).click();
  await expect(page.getByText("Роль обновлена")).toBeVisible();
}

/** Отметить / снять главу цеха в окне цеха (настройки → цеха). */
async function setDepartmentHead(page: Page, departmentName: string, memberName: string, checked: boolean) {
  await page.goto(projectPath(ctx, "/settings/departments"));
  const row = page.locator(`div:has(> button[aria-label="Перетащить цех «${departmentName}»"])`);
  await row.getByRole("button", { name: "Изменить" }).click();
  const dialog = page.getByRole("dialog", { name: `Цех: ${departmentName}` });
  // Свой чекбокс: настоящий input под рисунком — отмечаем напрямую.
  await dialog.getByLabel(new RegExp(memberName)).setChecked(checked, { force: true });
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Цех сохранён")).toBeVisible();
}

async function grantRow(role: E2ERoleKey, folderId: string) {
  return db.driveFolderGrant.findFirst({
    where: { folderId, user: { email: email(role) } },
    select: { status: true, lastError: true, permissionId: true, email: true, role: true },
  });
}

const e2eEmails = Object.values(E2E_ROLES).map((r) => r.email);
let restore: {
  nofin: { roleId: string; status: string };
  nocallsheet: { roleId: string; status: string };
  googleEmails: { email: string; googleEmail: string | null }[];
};
let producerUserId: string;
let departmentName: string;
let common: { folderId: string; externalId: string };
let dept: { folderId: string; externalId: string };

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — доступы проверяются только на заглушке");
test.use({ storageState: storageStatePath("producer") });

test.beforeAll(async () => {
  if (!STUB) return;
  await stub("/reset", {});
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: e2eEmails } } } });
  const [nofin, nocallsheet, producer] = await Promise.all([
    membership("nofin"),
    membership("nocallsheet"),
    membership("producer"),
  ]);
  producerUserId = producer.userId;
  restore = {
    nofin: { roleId: nofin.roleId, status: nofin.status },
    nocallsheet: { roleId: nocallsheet.roleId, status: nocallsheet.status },
    googleEmails: await db.user.findMany({
      where: { email: { in: e2eEmails } },
      select: { email: true, googleEmail: true },
    }),
  };
  await db.user.updateMany({ where: { email: { in: e2eEmails } }, data: { googleEmail: null } });
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  departmentName = (
    await db.department.findUniqueOrThrow({ where: { id: ctx.departmentId }, select: { name: true } })
  ).name;
});

test.afterAll(async () => {
  if (!STUB) return;
  for (const role of ["nofin", "nocallsheet"] as const) {
    const m = await membership(role);
    await db.projectMembership.update({
      where: { id: m.id },
      data: { roleId: restore[role].roleId, status: restore[role].status as "ACTIVE" },
    });
  }
  for (const u of restore.googleEmails) {
    await db.user.update({ where: { email: u.email }, data: { googleEmail: u.googleEmail } });
  }
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: e2eEmails } } } });
  await db.$disconnect();
});

test("папки: PELENA · Проект / Вызывные / Общая и Цеха / <Цех>; доступы — «Общая» с вызывными, цех — продюсеры", async ({ page }) => {
  // Диск проекта подключает владелец (он же хранитель).
  await page.goto(SETTINGS);
  await page.getByTestId("project-drive").getByRole("button", { name: "Подключить Google Диск" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Перейти в Google" }).click();
  await expect(page.getByTestId("cloud-oauth-notice")).toHaveText("Диск проекта подключён");
  await expect(page.getByTestId("project-drive-access-summary")).toContainText("Папок ещё нет");

  common = ensureFolder(producerUserId, "common");
  expect(common).toMatchObject({ outcome: "created" });
  dept = ensureFolder(producerUserId, ctx.departmentId);
  expect(dept).toMatchObject({ outcome: "created" });
  // Повторно — та же папка, без новых запросов на создание.
  expect(ensureFolder(producerUserId, "common")).toMatchObject({ outcome: "existing", externalId: common.externalId });

  const { google } = await stub<StubState>("/state");
  const byId = new Map(google.files.map((f) => [f.id, f]));
  const chain = (id: string) => {
    const names: string[] = [];
    for (let f = byId.get(id); f; f = byId.get(f.parents[0])) names.unshift(f.name);
    return names.join(" / ");
  };
  expect(chain(common.externalId)).toBe("PELENA · E2E приёмка / Вызывные / Общая");
  expect(chain(dept.externalId)).toBe(`PELENA · E2E приёмка / Вызывные / Цеха / ${departmentName}`);
  expect(google.files.filter((f) => f.mimeType === "application/vnd.google-apps.folder")).toHaveLength(5);

  // Доступ — только конечным папкам: у PELENA, «Вызывные», «Цеха» выдач нет (риск 9).
  const leaves = new Set([common.externalId, dept.externalId]);
  expect(google.permissions.filter((p) => !leaves.has(p.fileId))).toEqual([]);
  expect(await emailsOf(common.externalId)).toEqual([email("nofin"), email("producer")].sort());
  expect(await emailsOf(dept.externalId)).toEqual([email("producer")]);
  for (const p of google.permissions) {
    expect(p.role).toBe("commenter");
    expect(p.sendNotificationEmail).toBe(true);
  }

  const rows = await db.driveFolderGrant.findMany({ where: { folderId: { in: [common.folderId, dept.folderId] } } });
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.status === "OK" && r.permissionId)).toBe(true);

  await page.goto(SETTINGS);
  await expect(page.getByTestId("project-drive-access-summary")).toContainText("Папок: 2 · выдано доступов: 3");
  await expect(page.getByTestId("project-drive-unsynced")).toHaveCount(0);

  // Журнал: выдача при создании папки — без почт.
  const audit = await db.auditLog.findFirst({
    where: { projectId: ctx.projectId, entityType: "project_drive", summary: { contains: "синхронизированы" } },
    orderBy: { createdAt: "desc" },
    select: { summary: true, changes: true },
  });
  expect(audit?.summary).toContain("выдано");
  expect(JSON.stringify(audit)).not.toContain("@");
});

test("глава цеха: назначение → доступ к папке цеха; снятие → доступ снят; ручной доступ не тронут", async ({ page }) => {
  await stub(`/google/files/${dept.externalId}/permissions`, { email: MANUAL_EMAIL, role: "writer" });

  await setDepartmentHead(page, departmentName, E2E_ROLES.nocallsheet.name, true);
  await expectSystemGrants(dept.externalId, [email("producer"), email("nocallsheet")]);
  // Роль без вызывных «Общую» не получает, даже будучи главой.
  expect(await emailsOf(common.externalId)).not.toContain(email("nocallsheet"));

  await setDepartmentHead(page, departmentName, E2E_ROLES.nocallsheet.name, false);
  await expectSystemGrants(dept.externalId, [email("producer")]);
  expect(await emailsOf(dept.externalId, { manual: true })).toEqual([MANUAL_EMAIL]);
  expect(await grantRow("nocallsheet", dept.folderId)).toBeNull();
});

test("переименование цеха → папка цеха на диске переименована", async ({ page }) => {
  const renamed = `${departmentName} E2E`;
  const folderName = async () =>
    (await stub<StubState>("/state")).google.files.find((f) => f.id === dept.externalId)?.name;
  for (const [from, to] of [
    [departmentName, renamed],
    [renamed, departmentName],
  ]) {
    await page.goto(projectPath(ctx, "/settings/departments"));
    const row = page.locator(`div:has(> button[aria-label="Перетащить цех «${from}»"])`);
    await row.getByRole("button", { name: "Изменить" }).click();
    const dialog = page.getByRole("dialog", { name: `Цех: ${from}` });
    await dialog.getByLabel("Название *").fill(to);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Цех сохранён")).toBeVisible();
    await expect.poll(folderName, { timeout: 20_000 }).toBe(to);
  }
});

test("удаление участника → доступ снят; возврат + «Синхронизировать доступы» → выдан снова", async ({ page }) => {
  await stub(`/google/files/${common.externalId}/permissions`, { email: MANUAL_EMAIL, role: "reader" });

  await page.goto(projectPath(ctx, "/members"));
  const removalSyncs = () =>
    db.auditLog.count({
      where: {
        projectId: ctx.projectId,
        entityType: "project_drive",
        changes: { path: ["trigger"], equals: "member_removed" },
      },
    });
  const syncsBefore = await removalSyncs();
  const row = page.locator("tr").filter({ hasText: email("nofin") });
  await row.getByRole("button", { name: "Удалить" }).click();
  const dialog = page.getByRole("dialog", { name: /Удалить участника/ });
  await dialog.getByRole("button", { name: "Удалить" }).click();
  await expect(dialog).toHaveCount(0);

  await expectSystemGrants(common.externalId, [email("producer")]);
  expect(await emailsOf(common.externalId, { manual: true })).toEqual([MANUAL_EMAIL]);
  // Пересчёт после удаления закончен (запись в журнале) — иначе его следующий проход увидит
  // возвращённого ниже участника и выдаст доступ сам, раньше кнопки.
  await expect.poll(removalSyncs, { timeout: 45_000 }).toBe(syncsBefore + 1);

  // Вернули в проект (как после повторного приглашения) — кнопка синхронизации выдаёт доступ.
  const m = await membership("nofin");
  await db.projectMembership.update({ where: { id: m.id }, data: { status: "ACTIVE", roleId: restore.nofin.roleId } });
  await page.goto(SETTINGS);
  await page.getByRole("button", { name: "Синхронизировать доступы" }).click();
  await expect(page.getByText("Доступы синхронизированы: выдано 1")).toBeVisible();
  expect(await emailsOf(common.externalId, { manual: false })).toEqual([email("nofin"), email("producer")].sort());
  expect(await emailsOf(common.externalId, { manual: true })).toEqual([MANUAL_EMAIL]);
});

test("ошибка Google при выдаче: роль сменилась, строка «не синхронизировано», «Повторить» чинит", async ({ page }) => {
  await stub("/config", {
    failNext: [
      {
        provider: "google",
        match: "permissions.create",
        status: 400,
        body: { error: { code: 400, message: "Bad Request", errors: [{ reason: "invalidSharingRequest" }] } },
      },
    ],
  });
  // «Без вызывных» получает роль с просмотром вызывных — действие проходит, Google отказывает.
  await pickRole(page, "nocallsheet", E2E_ROLE_NAMES.nofin);
  await expect
    .poll(async () => (await grantRow("nocallsheet", common.folderId))?.status, { timeout: 20_000 })
    .toBe("FAILED");
  expect((await membership("nocallsheet")).roleId).toBe(restore.nofin.roleId);

  await page.goto(SETTINGS);
  const failed = page.getByTestId("project-drive-unsynced-row");
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText(E2E_ROLES.nocallsheet.name);
  await expect(failed).toContainText("Общая");
  await expect(failed).toContainText("Google не может выдать доступ на эту почту");
  await expect(failed).toContainText(email("nocallsheet"));
  await expect(failed).toContainText("почта не Google");
  await stateShot(page, "drive-not-synced", "project-drive-unsynced");

  const audit = await db.auditLog.findFirst({
    where: { projectId: ctx.projectId, entityType: "project_drive", summary: { startsWith: "Ошибка синхронизации" } },
    orderBy: { createdAt: "desc" },
    select: { summary: true, changes: true },
  });
  expect(audit).not.toBeNull();
  expect(JSON.stringify(audit)).not.toContain("@");

  await failed.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByText("Доступы синхронизированы: выдано 1")).toBeVisible();
  await expect(page.getByTestId("project-drive-unsynced")).toHaveCount(0);
  expect(await emailsOf(common.externalId, { manual: false })).toContain(email("nocallsheet"));
  expect((await grantRow("nocallsheet", common.folderId))?.status).toBe("OK");
});

test("лимит частоты Google: повтор с паузой — доступ выдан", async ({ page }) => {
  await pickRole(page, "nocallsheet", E2E_ROLE_NAMES.nocallsheet);
  await expectSystemGrants(common.externalId, [email("nofin"), email("producer")]);

  const before = (await stub<StubRequest[]>("/requests")).length;
  await stub("/config", {
    failNext: [
      {
        provider: "google",
        match: "permissions.create",
        status: 403,
        times: 2,
        body: { error: { code: 403, message: "Rate limit", errors: [{ reason: "sharingRateLimitExceeded" }] } },
      },
    ],
  });
  await pickRole(page, "nocallsheet", E2E_ROLE_NAMES.nofin);
  await expectSystemGrants(common.externalId, [email("nocallsheet"), email("nofin"), email("producer")]);
  const creates = (await stub<StubRequest[]>("/requests"))
    .slice(before)
    .filter((r) => r.op === "permissions.create")
    .map((r) => r.status);
  expect(creates).toEqual([403, 403, 200]);
  // Строка в базе обновляется сразу после ответа Google — чуть позже, чем заглушка его записала.
  await expect
    .poll(async () => (await grantRow("nocallsheet", common.folderId))?.status, { timeout: 10_000 })
    .toBe("OK");
});

test("смена «Почты для Google» → старый доступ снят, выдан на новую; профиль показывает почту и расхождение", async ({ browser }) => {
  const { context, page } = await openAs(browser, "nofin");
  await page.goto("/ru/profile");
  await expect(page.getByTestId("profile-drive-email")).toContainText(
    `Доступ к папкам проекта будет выдан на ${email("nofin")}`,
  );
  await page.getByLabel("Почта для Google").fill(NOFIN_GOOGLE);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Профиль сохранён")).toBeVisible();
  await expect(page.getByTestId("profile-drive-email")).toContainText(
    `Доступ к папкам проекта будет выдан на ${NOFIN_GOOGLE}`,
  );

  await expectSystemGrants(common.externalId, [NOFIN_GOOGLE, email("nocallsheet"), email("producer")]);
  await expect
    .poll(async () => (await grantRow("nofin", common.folderId))?.status, { timeout: 10_000 })
    .toBe("OK");
  expect(await grantRow("nofin", common.folderId)).toMatchObject({ email: NOFIN_GOOGLE, role: "commenter" });
  expect(await emailsOf(common.externalId, { manual: true })).toEqual([MANUAL_EMAIL]);

  // Личный Google подключён другим аккаунтом — предупреждение о возможной опечатке.
  await expect(page.getByTestId("profile-drive-email-mismatch")).toHaveCount(0);
  await page
    .getByTestId("cloud-connection-GOOGLE_DRIVE")
    .getByRole("button", { name: /Подключить|Переподключить/ })
    .click();
  await expect(page.getByTestId("cloud-oauth-notice")).toContainText("подключён");
  await expect(page.getByTestId("profile-drive-email-mismatch")).toContainText("stub-google@example.com");
  await context.close();
});

test("доступ к диску проекта отозван во время синхронизации → «нужно переподключить», без падений", async ({ page }) => {
  await stub("/config", { failNext: [{ provider: "google", match: "permissions.list", status: 401 }] });
  await page.goto(SETTINGS);
  await page.getByRole("button", { name: "Синхронизировать доступы" }).click();
  await expect(page.getByText("Доступ к диску проекта отозван — нужно переподключить")).toBeVisible();
  await expect(page.getByTestId("project-drive-reconnect")).toBeVisible();
  const drive = await db.projectDrive.findUniqueOrThrow({
    where: { projectId: ctx.projectId },
    select: { status: true, needsReconnectAt: true },
  });
  expect(drive.status).toBe("ACTIVE");
  expect(drive.needsReconnectAt).not.toBeNull();
  // Доступы у Google на месте — система ничего не сняла.
  expect(await emailsOf(common.externalId, { manual: false })).toHaveLength(3);
});
