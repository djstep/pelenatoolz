import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { E2E_ROLE_NAMES, E2E_ROLES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { findLeaks, workbookText } from "./helpers/leaks";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Выгрузка вызывного на диск проекта — «Общая» и папка цеха (шаг 6 волны дисков). Против
 * заглушки дисков, как `c3`–`c5`: dev-сервер с адресами заглушки (конфигурация `dev-cloud-stub`)
 * и `E2E_CLOUD_STUB_URL` у прогона. Без него — пропускается.
 *
 * Люди: «E2E Продюсер» (владелец, хранитель диска), «E2E Без финансов» (правка вызывных, без денег),
 * «E2E Без вызывных» — на время теста роль «просмотр вызывных без правки» и глава цеха «Звук».
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const SETTINGS = projectPath(ctx, "/settings");
const SOUND = "Звук";
const VIEWER_ROLE = "E2E вызывные просмотр";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME = "application/vnd.google-apps.folder";

type StubFile = { id: string; name: string; mimeType: string; parents: string[]; trashed: boolean; contentVersion: number };
type StubPermission = { id: string; fileId: string; emailAddress: string; manual?: boolean };
type StubState = { google: { files: StubFile[]; permissions: StubPermission[] } };

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
const e2eEmails = Object.values(E2E_ROLES).map((r) => r.email);

/** Путь файла на диске заглушки: «PELENA · … / Вызывные / Общая / <файл>». */
async function chainOf(fileId: string) {
  const { google } = await stub<StubState>("/state");
  const byId = new Map(google.files.map((f) => [f.id, f]));
  const names: string[] = [];
  for (let f = byId.get(fileId); f; f = byId.get(f.parents[0])) names.unshift(f.name);
  return names.join(" / ");
}

async function filesIn(folderExternalId: string) {
  const { google } = await stub<StubState>("/state");
  return google.files.filter((f) => f.mimeType === SHEET_MIME && !f.trashed && f.parents.includes(folderExternalId));
}

/** Почты, которым система выдала доступ к папке у Google. */
async function grantedEmails(folderExternalId: string) {
  const { google } = await stub<StubState>("/state");
  return google.permissions
    .filter((p) => p.fileId === folderExternalId && !p.manual)
    .map((p) => p.emailAddress.toLowerCase())
    .sort();
}

const membership = async (role: E2ERoleKey) =>
  db.projectMembership.findFirstOrThrow({
    where: { projectId: ctx.projectId, user: { email: email(role) } },
    select: { id: true, roleId: true, userId: true },
  });

/** Папка диска проекта в базе (ключ `common` / `dept:<id>`). */
async function driveFolder(key: string) {
  return db.driveFolder.findFirst({
    where: { projectId: ctx.projectId, projectDriveId: { not: null }, key },
    select: { id: true, externalId: true },
  });
}

async function exportIn(folderId: string, dayNumber: number) {
  return db.driveExport.findFirst({
    where: { folderId, docType: "CALL_SHEET", docId: dayId(ctx, dayNumber) },
    select: { externalId: true, uploadedAt: true },
  });
}

async function openAs(browser: Browser, role: E2ERoleKey) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

/** Сессия другой роли в уже открытом окне: дальше запросы уходят с её куками. */
async function switchSession(context: BrowserContext, role: E2ERoleKey) {
  const { cookies } = JSON.parse(readFileSync(storageStatePath(role), "utf8")) as {
    cookies: Parameters<BrowserContext["addCookies"]>[0];
  };
  await context.clearCookies();
  await context.addCookies(cookies);
}

async function openDriveDialog(page: Page, dayNumber: number): Promise<Locator> {
  await page.goto(projectPath(ctx, `/call-sheets/${dayId(ctx, dayNumber)}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  await page.getByRole("menuitem", { name: "На диск…" }).click();
  const dialog = page.getByRole("dialog", { name: "Вызывной на диск" });
  await expect(dialog.getByText("Куда")).toBeVisible();
  return dialog;
}

const COMMON_RADIO = /Диск проекта — Общая/;
const DEPT_RADIO = /Диск проекта — папка цеха/;

async function chooseDepartment(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole("radio", { name: DEPT_RADIO }).check();
  await dialog.locator("#drive-export-department-trigger").click();
  await page.getByRole("option", { name, exact: true }).click();
}

/** Нажать «Выгрузить» и дождаться итога: текст «готово» или ошибки. */
async function clickUpload(dialog: Locator) {
  await dialog.getByRole("button", { name: /^Выгрузить/ }).click();
  const result = dialog.locator('[data-testid="drive-export-done"], [role="alert"]');
  await expect(result.first()).toBeVisible({ timeout: 60_000 });
  return (await result.first().innerText()).trim();
}

async function uploadCommon(dialog: Locator) {
  await dialog.getByRole("radio", { name: COMMON_RADIO }).check();
  return clickUpload(dialog);
}

async function lastAudit(entityType: string, contains: string) {
  return db.auditLog.findFirst({
    where: { projectId: ctx.projectId, entityType, summary: { contains } },
    orderBy: { createdAt: "desc" },
    select: { summary: true, changes: true },
  });
}

let roleIds: { nofin: string; nocallsheet: string; producer: string };
let googleEmails: { email: string; googleEmail: string | null }[];
let soundId: string;
let transportName: string;

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — выгрузка на диск проекта проверяется только на заглушке");
test.use({ storageState: storageStatePath("producer") });

test.beforeAll(async ({ browser }) => {
  if (!STUB) return;
  await stub("/reset", {});
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: e2eEmails } } } });

  const roleId = async (name: string) =>
    (await db.projectRoleDefinition.findFirstOrThrow({ where: { projectId: ctx.projectId, name }, select: { id: true } })).id;
  roleIds = {
    nofin: await roleId(E2E_ROLE_NAMES.nofin),
    nocallsheet: await roleId(E2E_ROLE_NAMES.nocallsheet),
    producer: (await membership("producer")).roleId,
  };
  googleEmails = await db.user.findMany({ where: { email: { in: e2eEmails } }, select: { email: true, googleEmail: true } });
  await db.user.updateMany({ where: { email: { in: e2eEmails } }, data: { googleEmail: null } });

  // Остатки прошлого прогона, если он оборвался.
  const nocallsheet = await membership("nocallsheet");
  await db.projectMembership.update({ where: { id: nocallsheet.id }, data: { roleId: roleIds.nocallsheet } });
  await db.projectRoleDefinition.deleteMany({ where: { projectId: ctx.projectId, name: VIEWER_ROLE } });
  await db.department.deleteMany({ where: { projectId: ctx.projectId, name: SOUND } });

  // Роль «просмотр вызывных без правки»: как «без финансов», но в КПП и вызывных — только просмотр.
  const nofinRole = await db.projectRoleDefinition.findUniqueOrThrow({ where: { id: roleIds.nofin } });
  const perms = nofinRole.permissions as Record<string, Record<string, boolean>>;
  const viewer = await db.projectRoleDefinition.create({
    data: {
      projectId: ctx.projectId,
      name: VIEWER_ROLE,
      permissions: { ...perms, schedule: { ...perms.schedule, read: true, create: false, update: false, delete: false } },
    },
  });
  const sound = await db.department.create({ data: { projectId: ctx.projectId, name: SOUND, codePrefix: "ZVUK" } });
  soundId = sound.id;
  transportName = (await db.department.findUniqueOrThrow({ where: { id: ctx.departmentId }, select: { name: true } })).name;
  await db.projectMembership.update({ where: { id: nocallsheet.id }, data: { roleId: viewer.id } });
  await db.departmentHead.create({ data: { departmentId: soundId, membershipId: nocallsheet.id } });

  // Личный Google продюсера (для «личный диск работает») и диск проекта — хранитель продюсер.
  const { context, page } = await openAs(browser, "producer");
  await page.goto("/ru/profile");
  await page.getByTestId("cloud-connection-GOOGLE_DRIVE").getByRole("button", { name: /Подключить|Переподключить/ }).click();
  await expect(page.getByTestId("cloud-oauth-notice")).toContainText("подключён");
  await page.goto(SETTINGS);
  await page.getByTestId("project-drive").getByRole("button", { name: "Подключить Google Диск" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Перейти в Google" }).click();
  await expect(page.getByTestId("cloud-oauth-notice")).toHaveText("Диск проекта подключён");
  await context.close();
});

test.afterAll(async () => {
  if (!STUB) return;
  const [nofin, nocallsheet] = await Promise.all([membership("nofin"), membership("nocallsheet")]);
  await db.projectMembership.update({ where: { id: nofin.id }, data: { roleId: roleIds.nofin, status: "ACTIVE" } });
  await db.projectMembership.update({ where: { id: nocallsheet.id }, data: { roleId: roleIds.nocallsheet } });
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.department.deleteMany({ where: { projectId: ctx.projectId, name: SOUND } });
  await db.projectRoleDefinition.deleteMany({ where: { projectId: ctx.projectId, name: VIEWER_ROLE } });
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: e2eEmails } } } });
  for (const u of googleEmails) {
    await db.user.update({ where: { email: u.email }, data: { googleEmail: u.googleEmail } });
  }
  await db.$disconnect();
});

test("первая выгрузка в «Общую»: папки PELENA · Проект / Вызывные / Общая, доступы, Google Таблица", async ({ page }) => {
  const dialog = await openDriveDialog(page, 1);
  // Продюсеру видны все назначения.
  await expect(dialog.getByRole("radio", { name: /Мой Google/ })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: DEPT_RADIO })).toBeVisible();
  await expect(dialog.getByTestId("drive-export-audience-common")).toHaveText(
    "Кто увидит: Все участники с доступом к вызывным",
  );
  expect(await uploadCommon(dialog)).toContain("Вызывной выгружен на диск проекта — «Общая»");
  await expect(dialog.getByRole("button", { name: "Копировать ссылку" })).toBeVisible();

  const common = await driveFolder("common");
  expect(common).not.toBeNull();
  const row = await exportIn(common!.id, 1);
  expect(row).not.toBeNull();
  expect(await chainOf(row!.externalId)).toMatch(
    /^PELENA · E2E приёмка \/ Вызывные \/ Общая \/ Вызывной · день 1 · \d\d\.\d\d\.\d{4}( · версия \d+)? \((черновик|на согласовании|утверждён)\)$/,
  );
  expect(await filesIn(common!.externalId)).toHaveLength(1);

  // Доступы новой папке выдаются после ответа: все с просмотром вызывных.
  await expect
    .poll(() => grantedEmails(common!.externalId), { timeout: 20_000 })
    .toEqual([email("nocallsheet"), email("nofin"), email("producer")].sort());

  const audit = await lastAudit("drive_export", "выгружен на диск проекта — «Общая»");
  expect(audit?.summary).toMatch(/^Вызывной дня 1 /);
  expect(audit?.changes).toMatchObject({ destination: "common", outcome: "created", dayId: dayId(ctx, 1) });
  expect(JSON.stringify(audit)).not.toMatch(/@|https?:/);
});

test("повторная выгрузка в «Общую» → тот же файл, ссылка прежняя; «уже на диске» в окне", async ({ page }) => {
  const common = (await driveFolder("common"))!;
  const [before] = await filesIn(common.externalId);
  const dialog = await openDriveDialog(page, 1);
  await dialog.getByRole("radio", { name: COMMON_RADIO }).check();
  await expect(dialog.getByTestId("drive-export-existing")).toContainText(E2E_ROLES.producer.name);
  expect(await clickUpload(dialog)).toContain("Файл на диске проекта («Общая») обновлён — ссылка прежняя");

  const after = await filesIn(common.externalId);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before.id);
  expect(after[0].contentVersion).toBe(before.contentVersion + 1);
  expect((await exportIn(common.id, 1))?.externalId).toBe(before.id);
  const audit = await lastAudit("drive_export", "выгружен на диск проекта — «Общая»");
  expect(audit?.changes).toMatchObject({ outcome: "replaced" });
});

test("две первые выгрузки одновременно → одна папка «Общая», один файл", async ({ page, context }) => {
  // С чистого листа: система «забывает» папки диска проекта (выгрузки и доступы — каскадом).
  const drive = await db.projectDrive.findUniqueOrThrow({ where: { projectId: ctx.projectId }, select: { id: true } });
  await db.driveFolder.deleteMany({ where: { projectDriveId: drive.id } });
  const commonFolders = async () =>
    (await stub<StubState>("/state")).google.files.filter((f) => f.mimeType === FOLDER_MIME && f.name === "Общая").length;
  const foldersBefore = await commonFolders();

  const second = await context.newPage();
  const [a, b] = await Promise.all([openDriveDialog(page, 2), openDriveDialog(second, 2)]);
  await a.getByRole("radio", { name: COMMON_RADIO }).check();
  await b.getByRole("radio", { name: COMMON_RADIO }).check();
  const results = await Promise.all([clickUpload(a), clickUpload(b)]);
  expect(results.sort()).toEqual([
    expect.stringContaining("Вызывной выгружен на диск проекта — «Общая»"),
    expect.stringContaining("обновлён — ссылка прежняя"),
  ]);
  await second.close();

  expect(await commonFolders()).toBe(foldersBefore + 1);
  expect(await db.driveFolder.count({ where: { projectDriveId: drive.id, key: "common" } })).toBe(1);
  const common = (await driveFolder("common"))!;
  const files = await filesIn(common.externalId);
  expect(files).toHaveLength(1);
  expect((await exportIn(common.id, 2))?.externalId).toBe(files[0].id);
});

test("глава «Звука» выгружает в «Звук»; в чужой цех и в «Общую» без правки — отказ на сервере", async ({ browser }) => {
  const head = await openAs(browser, "nocallsheet");
  const dialog = await openDriveDialog(head.page, 1);
  // «Общей» у него нет (нет правки вызывных), в цехах — только свой.
  await expect(dialog.getByRole("radio", { name: COMMON_RADIO })).toHaveCount(0);
  await dialog.getByRole("radio", { name: DEPT_RADIO }).check();
  await expect(dialog.getByTestId("drive-export-audience-department")).toHaveText(
    `Кто увидит: Главы цеха «${SOUND}» и продюсеры`,
  );
  await dialog.locator("#drive-export-department-trigger").click();
  await expect(head.page.getByRole("option")).toHaveText([SOUND]);
  await head.page.getByRole("option", { name: SOUND }).click();
  expect(await clickUpload(dialog)).toContain(`Вызывной выгружен на диск проекта — папка цеха «${SOUND}»`);
  await head.context.close();

  const folder = (await driveFolder(`dept:${soundId}`))!;
  const row = await exportIn(folder.id, 1);
  expect(await chainOf(row!.externalId)).toMatch(
    new RegExp(`^PELENA · E2E приёмка / Вызывные / Цеха / ${SOUND} / Вызывной · день 1 · `),
  );
  await expect
    .poll(() => grantedEmails(folder.externalId), { timeout: 20_000 })
    .toEqual([email("nocallsheet"), email("producer")].sort());

  // Окно открыто продюсером (видит все цеха и «Общую»), запросы уходят с сессией главы «Звука».
  const filesBefore = (await stub<StubState>("/state")).google.files.length;
  const auditBefore = await db.auditLog.count({ where: { projectId: ctx.projectId, entityType: "drive_export" } });
  const other = await openAs(browser, "producer");
  const foreign = await openDriveDialog(other.page, 1);
  await chooseDepartment(other.page, foreign, transportName);
  await switchSession(other.context, "nocallsheet");
  expect(await clickUpload(foreign)).toContain("Недостаточно прав");
  expect(await uploadCommon(foreign)).toContain("Недостаточно прав");
  await other.context.close();

  expect((await stub<StubState>("/state")).google.files.length).toBe(filesBefore);
  expect(await driveFolder(`dept:${ctx.departmentId}`)).toBeNull();
  expect(await db.auditLog.count({ where: { projectId: ctx.projectId, entityType: "drive_export" } })).toBe(auditBefore);
});

test("без финансов: в файл на диске проекта не попадают деньги", async ({ browser }) => {
  const { context, page } = await openAs(browser, "nofin");
  const dialog = await openDriveDialog(page, 1);
  expect(await uploadCommon(dialog)).toMatch(/диск проекта/);
  await context.close();

  const common = (await driveFolder("common"))!;
  const row = await exportIn(common.id, 1);
  expect(row).not.toBeNull();
  const res = await fetch(`${STUB}/__stub/google/files/${row!.externalId}/content`);
  expect(res.status).toBe(200);
  const text = await workbookText(Buffer.from(await res.arrayBuffer()));
  expect(text).toContain("E2E приёмка");
  expect(findLeaks("файл на диске проекта (без финансов)", text)).toEqual([]);
});

test("доступ к диску проекта отозван во время выгрузки → «нужно переподключить», понятная ошибка", async ({ page }) => {
  const dialog = await openDriveDialog(page, 1);
  await dialog.getByRole("radio", { name: COMMON_RADIO }).check();
  await stub("/config", { failNext: [{ provider: "google", match: "files.get", status: 401 }] });
  expect(await clickUpload(dialog)).toContain("Доступ к диску проекта отозван");
  await expect(dialog.getByTestId("drive-export-project-unavailable")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: COMMON_RADIO })).toHaveCount(0);

  const drive = await db.projectDrive.findUniqueOrThrow({
    where: { projectId: ctx.projectId },
    select: { status: true, needsReconnectAt: true },
  });
  expect(drive.status).toBe("ACTIVE");
  expect(drive.needsReconnectAt).not.toBeNull();
  expect(await lastAudit("project_drive", "доступ отозван")).not.toBeNull();

  // Как после «Переподключить» того же аккаунта.
  await db.projectDrive.update({ where: { projectId: ctx.projectId }, data: { needsReconnectAt: null } });
});

test("хранителя удалили → диск проекта отключён: отказ на сервере, личный диск работает", async ({ page, context, browser }) => {
  // Хранитель — продюсер-не-владелец «E2E Без финансов».
  const nofin = await membership("nofin");
  await db.projectMembership.update({ where: { id: nofin.id }, data: { roleId: roleIds.producer } });
  await db.projectDrive.update({ where: { projectId: ctx.projectId }, data: { keeperMembershipId: nofin.id } });

  // Окно открыто, пока диск жив.
  const dialog = await openDriveDialog(page, 1);
  await dialog.getByRole("radio", { name: COMMON_RADIO }).check();

  const members = await context.newPage();
  await members.goto(projectPath(ctx, "/members"));
  await members.locator("tr").filter({ hasText: email("nofin") }).getByRole("button", { name: "Удалить" }).click();
  const confirm = members.getByRole("dialog", { name: /Удалить участника/ });
  await expect(confirm).toContainText("хранитель диска проекта");
  await confirm.getByRole("button", { name: "Удалить" }).click();
  await expect(confirm).toHaveCount(0);
  await members.close();
  expect(
    (await db.projectDrive.findUniqueOrThrow({ where: { projectId: ctx.projectId }, select: { status: true } })).status,
  ).toBe("DETACHED");

  const filesBefore = (await stub<StubState>("/state")).google.files.length;
  expect(await clickUpload(dialog)).toContain("Диск проекта не подключён — подключите его в настройках проекта");
  expect((await stub<StubState>("/state")).google.files.length).toBe(filesBefore);
  const notice = dialog.getByTestId("drive-export-project-unavailable");
  await expect(notice).toContainText("Диск проекта не подключён");
  await expect(notice.getByRole("link", { name: "Открыть настройки проекта" })).toHaveAttribute(
    "href",
    `/ru/projects/${ctx.projectId}/settings`,
  );
  await expect(dialog.getByRole("radio", { name: COMMON_RADIO })).toHaveCount(0);

  // Личный диск работает.
  await dialog.getByRole("radio", { name: /Мой Google/ }).check();
  expect(await clickUpload(dialog)).toMatch(/Вызывной выгружен на Google Диск|Файл на Google Диске обновлён/);

  // Роль без продюсера видит отказ «обратитесь к продюсеру» (возвращаем «Без финансов» в проект).
  await db.projectMembership.update({ where: { id: nofin.id }, data: { roleId: roleIds.nofin, status: "ACTIVE" } });
  const viewer = await openAs(browser, "nofin");
  const nofinDialog = await openDriveDialog(viewer.page, 1);
  await expect(nofinDialog.getByTestId("drive-export-project-unavailable")).toHaveText(
    "Диск проекта не подключён — обратитесь к продюсеру",
  );
  await viewer.context.close();
});
