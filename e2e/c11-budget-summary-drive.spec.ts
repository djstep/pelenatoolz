import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ROLES, MONEY, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * «На диск…» сводной (`BUDGET_DRIVE_NOTES.md`, шаг 5) — через окно на странице сводной, против
 * заглушки дисков. Диск проекта подключается к заглушке помощником (`e2e/helpers/budget-drive.ts
 * connect`), всё возвращается после прогона. Нужен dev-сервер с адресами заглушки и
 * `E2E_CLOUD_STUB_URL`; без него — пропуск.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const READ_ALL_ROLE = "E2E сметы все (c11)";

type StubFile = { id: string; name: string; parents: string[]; mimeType: string; copyRequiresWriterPermission: boolean };
type StubPermission = { fileId: string; emailAddress: string | null; manual?: boolean };
type StubState = { google: { files: StubFile[]; permissions: StubPermission[] } };

async function stub<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STUB}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

/** Сколько раз в «Google» что-то создавали или загружали (папки, файлы) — без доступов и токенов. */
async function fileWrites() {
  const log = await stub<Array<{ method?: string; path?: string }>>("/requests");
  return log.filter(
    (r) => /^(POST|PATCH)$/.test(r.method ?? "") && /\/drive\/v3\/files$|\/upload\/drive\/v3\/files/.test(r.path ?? ""),
  ).length;
}

function runHelper(script: string, ...args: string[]) {
  const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "development", CLOUD_STUB_GOOGLE_URL: `${STUB}/google` },
    timeout: 90_000,
  });
  return JSON.parse(out.trim().split("\n").pop() ?? "{}") as unknown;
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

const summaryPath = () => projectPath(ctx, "/smeta/summary");

async function openDriveDialog(page: Page) {
  await page.goto(summaryPath());
  await page.getByRole("button", { name: "На диск…" }).click({ timeout: 90_000 });
  const dialog = page.getByRole("dialog", { name: "Сводная смета на диск" });
  await expect(dialog.getByTestId("budget-drive-audience")).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Нажать «Выгрузить» и дождаться итога: текст «готово» или ошибки. */
async function clickUpload(dialog: ReturnType<Page["getByRole"]>) {
  await dialog.getByRole("button", { name: /^Выгрузить/ }).click();
  const result = dialog.locator('[data-testid="budget-drive-done"], [role="alert"]');
  await expect(result.first()).toBeVisible({ timeout: 60_000 });
  return (await result.first().innerText()).trim();
}

async function folderExternalId(key: string) {
  const row = await db.driveFolder.findFirst({
    where: { projectId: ctx.projectId, projectDrive: { projectId: ctx.projectId }, key },
    select: { externalId: true },
  });
  return row?.externalId ?? null;
}

const summaryExports = () =>
  db.driveExport.findMany({
    where: { projectId: ctx.projectId, docType: "BUDGET" },
    select: { docId: true, externalId: true, statusLabel: true, version: true },
  });
const email = (role: E2ERoleKey) => E2E_ROLES[role].email.toLowerCase();
const today = () =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(),
  );

const memberships = { producer: "", nofin: "", nocallsheet: "" };
let producerUserId = "";
const startedAt = new Date();
let readAllRoleId: string | null = null;
let restore: {
  heads: { departmentId: string; membershipId: string }[];
  googleEmails: { email: string; googleEmail: string | null }[];
  nocallsheetRoleId: string;
};

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — выгрузка сводной на диск проверяется только на заглушке");

test.beforeAll(async () => {
  for (const role of ["producer", "nofin", "nocallsheet"] as const) {
    const m = await db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, user: { email: E2E_ROLES[role].email } },
      select: { id: true, userId: true },
    });
    memberships[role] = m.id;
    if (role === "producer") producerUserId = m.userId;
  }
  const emails = Object.values(E2E_ROLES).map((r) => r.email);
  restore = {
    heads: await db.departmentHead.findMany({
      where: { departmentId: ctx.departmentId },
      select: { departmentId: true, membershipId: true },
    }),
    googleEmails: await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, googleEmail: true } }),
    nocallsheetRoleId: (await db.projectMembership.findUniqueOrThrow({ where: { id: memberships.nocallsheet } })).roleId,
  };
  await db.user.updateMany({ where: { email: { in: emails } }, data: { googleEmail: null } });

  // Глава «Транспортного цеха» — роль без финансов: сводную он не видит и не выгружает.
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });

  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await stub("/reset", {});
  runHelper("e2e/helpers/budget-drive.ts", "connect", ctx.projectId, memberships.producer);
});

test.afterAll(async () => {
  if (!STUB) return;
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  if (restore?.heads.length) await db.departmentHead.createMany({ data: restore.heads });
  if (restore) {
    await db.projectMembership.update({ where: { id: memberships.nocallsheet }, data: { roleId: restore.nocallsheetRoleId } });
    for (const u of restore.googleEmails) {
      await db.user.update({ where: { email: u.email }, data: { googleEmail: u.googleEmail } });
    }
  }
  if (readAllRoleId) await db.projectRoleDefinition.delete({ where: { id: readAllRoleId } });
  await db.$disconnect();
});

test("продюсер: «Экспорт Excel» сводной — имя по-русски, как на диске", async ({ browser }) => {
  const { context, page } = await openAs(browser, "producer");
  await page.goto(summaryPath());
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("button", { name: "Экспорт Excel" }).click({ timeout: 90_000 }),
  ]);
  expect(download.suggestedFilename()).toBe(`Сводная смета · утверждённые версии · ${today()}.xlsx`);
  await context.close();
});

test("продюсер выгружает «утверждённые версии»: файл в «Сметы / Сводная», запрет копирования, доступ — только продюсеры", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "producer");
  const dialog = await openDriveDialog(page);
  await expect(dialog.getByTestId("budget-drive-audience")).toHaveText("Кто увидит: Только продюсеры");
  await expect(dialog.getByTestId("budget-drive-snapshot")).toContainText(`Снимок на ${today()}`);
  await expect(dialog.getByTestId("budget-drive-snapshot")).toContainText("факт (начислено / оплачено) на дату выгрузки");
  await expect(dialog.getByTestId("budget-drive-approval-note")).toContainText("Утверждение — только в системе");
  await expect(dialog.getByTestId("budget-drive-keeper-hint")).toContainText("служебный аккаунт компании");
  await expect(dialog.getByTestId("budget-drive-existing")).toHaveCount(0);
  await expect(dialog.locator("#budget-summary-drive-mode")).toHaveValue("approved");

  expect(await clickUpload(dialog)).toContain("Сводная смета выгружена на диск проекта — «Сметы / Сводная»");

  const { google } = await stub<StubState>("/state");
  const folder = await folderExternalId("budget-summary");
  expect(google.files.find((f) => f.id === folder)?.parents).toEqual([await folderExternalId("budgets")]);
  const files = google.files.filter((f) => f.parents.includes(folder!));
  expect(files.map((f) => f.name)).toEqual([`Сводная смета · утверждённые версии · ${today()}`]);
  expect(files[0]!.copyRequiresWriterPermission).toBe(true);
  expect(await summaryExports()).toEqual([
    { docId: "summary", externalId: files[0]!.id, statusLabel: "утверждённые версии", version: null },
  ]);

  // Доступы папки выдаются после ответа (`after()`): только продюсер, глава цеха — нет.
  await expect
    .poll(async () => {
      const state = await stub<StubState>("/state");
      return state.google.permissions.filter((p) => p.fileId === folder).map((p) => p.emailAddress);
    }, { timeout: 30_000 })
    .toEqual([email("producer")]);
  await context.close();
});

test("повторно «с черновиками» — тот же файл, новое имя, флаг на месте; «Уже на диске»", async ({ browser }) => {
  const { context, page } = await openAs(browser, "producer");
  const dialog = await openDriveDialog(page);
  await expect(dialog.getByTestId("budget-drive-existing")).toContainText("утверждённые версии");
  await expect(dialog.getByTestId("budget-drive-keeper-hint")).toHaveCount(0);
  await dialog.locator("#budget-summary-drive-mode").selectOption("drafts");
  const before = (await summaryExports())[0]!.externalId;

  expect(await clickUpload(dialog)).toContain("ссылка прежняя");

  const rows = await summaryExports();
  expect(rows).toEqual([{ docId: "summary", externalId: before, statusLabel: "с черновиками", version: null }]);
  const { google } = await stub<StubState>("/state");
  const folder = await folderExternalId("budget-summary");
  const files = google.files.filter((f) => f.parents.includes(folder!));
  expect(files.map((f) => f.id)).toEqual([before]);
  expect(files[0]!.name).toBe(`Сводная смета · с черновиками · ${today()}`);
  expect(files[0]!.copyRequiresWriterPermission).toBe(true);
  expect(
    google.permissions.filter((p) => p.fileId === folder).map((p) => p.emailAddress),
  ).toEqual([email("producer")]);
  await context.close();
});

test("глава цеха: сводной и кнопки нет, прямой запрос — «Недостаточно прав», в заглушку ничего", async ({ browser }) => {
  const { context, page } = await openAs(browser, "nofin");
  const res = await page.goto(summaryPath());
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("button", { name: "На диск…" })).toHaveCount(0);
  await context.close();

  // Окно открыто продюсером, запрос уходит с сессией главы цеха.
  const prod = await openAs(browser, "producer");
  const dialog = await openDriveDialog(prod.page);
  const writes = await fileWrites();
  const rows = await summaryExports();
  await switchSession(prod.context, "nofin");
  expect(await clickUpload(dialog)).toBe("Недостаточно прав");
  expect(await fileWrites()).toBe(writes);
  expect(await summaryExports()).toEqual(rows);
  await prod.context.close();
});

test("«Сметы — просмотр всех»: сводную видит, кнопки «На диск…» и подписи нет, прямой запрос — «Недостаточно прав»", async ({
  browser,
}) => {
  const nofinRole = await db.projectMembership.findUniqueOrThrow({
    where: { id: memberships.nofin },
    select: { role: { select: { permissions: true } } },
  });
  const perms = nofinRole.role.permissions as Record<string, Record<string, boolean>>;
  readAllRoleId = (
    await db.projectRoleDefinition.create({
      data: {
        projectId: ctx.projectId,
        name: READ_ALL_ROLE,
        permissions: { ...perms, smeta_all: { ...perms.smeta_all, access: true, read: true } },
      },
    })
  ).id;
  await db.projectMembership.update({ where: { id: memberships.nocallsheet }, data: { roleId: readAllRoleId } });

  const { context, page } = await openAs(browser, "nocallsheet");
  await page.goto(summaryPath());
  await expect(page.getByRole("button", { name: "Экспорт Excel" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "На диск…" })).toHaveCount(0);
  await expect(page.getByTestId("budget-drive-unavailable")).toHaveCount(0);
  await context.close();

  const prod = await openAs(browser, "producer");
  const dialog = await openDriveDialog(prod.page);
  const writes = await fileWrites();
  await switchSession(prod.context, "nocallsheet");
  expect(await clickUpload(dialog)).toBe("Недостаточно прав");
  expect(await fileWrites()).toBe(writes);
  await prod.context.close();
});

test("файла сводной нет в папках цехов (смет и вызывных) и в «Общей»", async () => {
  // Папки цеха смет, цеха вызывных и «Общая» — настоящими функциями, как их создаёт выгрузка.
  runHelper("e2e/helpers/budget-drive.ts", "ensure", ctx.projectId, producerUserId, ctx.departmentId);
  runHelper("e2e/helpers/ensure-drive-folder.ts", ctx.projectId, producerUserId, "common");
  runHelper("e2e/helpers/ensure-drive-folder.ts", ctx.projectId, producerUserId, ctx.departmentId);
  // Помощники блокируют процесс теста: заглушка за это время закрыла простаивающее соединение,
  // а fetch узнает об этом, только когда цикл событий дойдёт до закрытия (иначе — ECONNRESET).
  await new Promise((resolve) => setTimeout(resolve, 500));

  const { google } = await stub<StubState>("/state");
  const summaryFolder = await folderExternalId("budget-summary");
  const summaryFiles = google.files.filter((f) => f.name.startsWith("Сводная смета"));
  expect(summaryFiles).toHaveLength(1);
  expect(summaryFiles[0]!.parents).toEqual([summaryFolder]);

  const others = await db.driveFolder.findMany({
    where: { projectId: ctx.projectId, key: { not: "budget-summary" } },
    select: { key: true, externalId: true },
  });
  const keys = others.map((f) => f.key);
  for (const key of ["common", `dept:${ctx.departmentId}`, `budget-dept:${ctx.departmentId}`]) {
    expect(keys).toContain(key);
  }
  const otherIds = new Set(others.map((f) => f.externalId));
  expect(summaryFiles.some((f) => f.parents.some((p) => otherIds.has(p)))).toBe(false);
  // В этих папках вообще нет файлов — только подпапки.
  const filesInOthers = google.files.filter(
    (f) => f.mimeType !== "application/vnd.google-apps.folder" && f.parents.some((p) => otherIds.has(p)),
  );
  expect(filesInOthers).toEqual([]);
});

test("журнал: «Выгрузка смет» без сумм, ссылок и почт", async () => {
  const rows = await db.auditLog.findMany({
    where: {
      projectId: ctx.projectId,
      entityType: "smeta_export",
      summary: { startsWith: "Сводная смета выгружена" },
      createdAt: { gte: startedAt },
    },
    select: { summary: true, changes: true },
  });
  expect(rows.map((r) => r.summary).sort()).toEqual(
    [
      "Сводная смета выгружена на диск проекта: утверждённые версии",
      "Сводная смета выгружена на диск проекта: с черновиками",
    ].sort(),
  );
  const text = JSON.stringify(rows);
  expect(text).not.toContain(MONEY.budgetRate.split(".")[0]);
  expect(text).not.toMatch(/https?:|@/);
});
