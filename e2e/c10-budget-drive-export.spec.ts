import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ROLES, MONEY, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";
import { MAIN_HEADERS } from "../src/features/smeta/lib/main-sheet";

/**
 * «На диск…» сметы цеха (`BUDGET_DRIVE_NOTES.md`, шаг 4) — через окно на странице сметы, против
 * заглушки дисков. Смета создаётся прямо в базе (как в c8), диск проекта подключается к заглушке
 * помощником (`e2e/helpers/budget-drive.ts connect`), всё возвращается после прогона.
 * Нужен dev-сервер с адресами заглушки и `E2E_CLOUD_STUB_URL`; без него — пропуск.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const OTHER_DEPT = "E2E Звук (диск)";
const READ_ALL_ROLE = "E2E сметы все (c10)";

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

function helper<T>(...args: string[]): T {
  const out = execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "e2e/helpers/budget-drive.ts", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development", CLOUD_STUB_GOOGLE_URL: `${STUB}/google` },
      timeout: 90_000,
    },
  );
  return JSON.parse(out.trim().split("\n").pop() ?? "{}") as T;
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

const smetaPath = () => projectPath(ctx, `/smeta/${ctx.departmentId}`);

async function openDriveDialog(page: Page) {
  await page.goto(smetaPath());
  await page.getByRole("button", { name: "На диск…" }).click({ timeout: 90_000 });
  const dialog = page.getByRole("dialog", { name: "Смета на диск" });
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

const budgetKey = () => `budget-dept:${ctx.departmentId}`;
const email = (role: E2ERoleKey) => E2E_ROLES[role].email.toLowerCase();
const today = () =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(),
  );

const memberships = { producer: "", nofin: "", nocallsheet: "" };
let budgetId: string | null = null;
let otherDeptId: string | null = null;
let readAllRoleId: string | null = null;
let restore: {
  heads: { departmentId: string; membershipId: string }[];
  googleEmails: { email: string; googleEmail: string | null }[];
  nocallsheetRoleId: string;
};

/** Сумма и Итого статьи сида: 2 × ставка × 1 день, налог 0 %. */
const TOTAL = Math.round(Number(MONEY.budgetRate) * 2 * 100) / 100;

function mainSheetData() {
  return {
    id: "main",
    name: "Основной",
    cellData: {
      0: Object.fromEntries(MAIN_HEADERS.map((h, i) => [i, { v: h, t: 1 }])),
      // Строка совпадает со статьёй сида целиком (единица, налог, формулы) — иначе редактор главы
      // при открытии допишет её сам и сохранит смету (после отправки это делает её черновиком).
      1: {
        0: { v: "TR-01.01", t: 1 },
        1: { v: "Спецтехника", t: 1 },
        2: { v: "смена", t: 1 },
        3: { v: 2, t: 2 },
        4: { v: Number(MONEY.budgetRate), t: 2 },
        5: { v: 1, t: 2 },
        // Значения формул — уже посчитанные (как сохраняет редактор), иначе он пересчитает и пересохранит.
        6: { v: TOTAL, t: 2, f: "=D2*E2*F2" },
        7: { v: 0, t: 2 },
        8: { v: 0, t: 2, f: "=G2*H2/100" },
        9: { v: TOTAL, t: 2, f: "=G2+I2" },
      },
    },
    columnData: { 1: { w: 220 } },
  };
}

/** Статья сида TR-01.01 — снимок до прогона, вернуть после (редактор главы может её пересохранить). */
const loadSeedItem = () =>
  db.budgetItem.findFirst({
    where: { projectId: ctx.projectId, departmentId: ctx.departmentId, code: "TR-01.01" },
    select: { id: true, unit: true, taxPercent: true, quantity: true, rate: true, days: true },
  });
let seedItem: Awaited<ReturnType<typeof loadSeedItem>> = null;

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — выгрузка смет на диск проверяется только на заглушке");

test.beforeAll(async () => {
  const existing = await db.budget.findFirst({ where: { departmentId: ctx.departmentId }, select: { id: true } });
  test.skip(!!existing, "У транспортного цеха тестового проекта уже есть смета — тест её не трогает");

  seedItem = await loadSeedItem();
  for (const role of ["producer", "nofin", "nocallsheet"] as const) {
    const m = await db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, user: { email: E2E_ROLES[role].email } },
      select: { id: true },
    });
    memberships[role] = m.id;
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

  // Глава «Транспортного цеха» — роль без финансов; глава другого цеха — роль без вызывных.
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });
  otherDeptId = (await db.department.create({ data: { projectId: ctx.projectId, name: OTHER_DEPT, codePrefix: "ZDSK" } })).id;
  await db.departmentHead.create({ data: { departmentId: otherDeptId, membershipId: memberships.nocallsheet } });

  const budget = await db.budget.create({
    data: { projectId: ctx.projectId, departmentId: ctx.departmentId, status: "SUBMITTED", styles: {} },
  });
  budgetId = budget.id;
  const main = await db.budgetSheet.create({
    data: { budgetId, sheetKey: "main", name: "Основной", sortOrder: 0, data: { create: { data: mainSheetData() } } },
  });
  await db.budget.update({ where: { id: budgetId }, data: { mainSheetId: main.id } });

  await stub("/reset", {});
  helper("connect", ctx.projectId, memberships.producer);
});

test.afterAll(async () => {
  if (!STUB) return;
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  if (budgetId) {
    await db.budget.update({ where: { id: budgetId }, data: { mainSheetId: null } });
    await db.budgetSheet.deleteMany({ where: { budgetId } });
    await db.budget.delete({ where: { id: budgetId } });
  }
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  if (restore?.heads.length) await db.departmentHead.createMany({ data: restore.heads });
  if (otherDeptId) {
    await db.departmentHead.deleteMany({ where: { departmentId: otherDeptId } });
    await db.department.delete({ where: { id: otherDeptId } });
  }
  if (restore) {
    await db.projectMembership.update({ where: { id: memberships.nocallsheet }, data: { roleId: restore.nocallsheetRoleId } });
    for (const u of restore.googleEmails) {
      await db.user.update({ where: { email: u.email }, data: { googleEmail: u.googleEmail } });
    }
  }
  if (readAllRoleId) await db.projectRoleDefinition.delete({ where: { id: readAllRoleId } });
  if (seedItem) {
    const { id, ...values } = seedItem;
    await db.budgetItem.update({ where: { id }, data: values });
  }
  await db.$disconnect();
});

test("глава без «Финансы: просмотр» выгружает смету своего цеха: файл в «Сметы / Цеха / <Цех>», запрет копирования, доступ — глава и продюсер", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "nofin");
  const dialog = await openDriveDialog(page);
  await expect(dialog.getByTestId("budget-drive-audience")).toHaveText("Кто увидит: Главы цеха «Транспортный цех» и продюсеры");
  await expect(dialog.getByTestId("budget-drive-keeper-hint")).toContainText("служебный аккаунт компании");
  await expect(dialog.getByTestId("budget-drive-approval-note")).toContainText("Утверждение — только в системе");
  await expect(dialog.locator("#budget-drive-version")).toHaveValue("current");

  const text = await clickUpload(dialog);
  expect(text).toContain("Смета выгружена на диск проекта — папка цеха «Транспортный цех» в «Сметах»");

  const { google } = await stub<StubState>("/state");
  const folder = await folderExternalId(budgetKey());
  const budgets = await folderExternalId("budgets");
  const departments = await folderExternalId("budget-departments");
  expect(google.files.find((f) => f.id === departments)?.parents).toEqual([budgets]);
  const files = google.files.filter((f) => f.parents.includes(folder!));
  expect(files.map((f) => f.name)).toEqual([`Смета · Транспортный цех · черновик (на утверждении) · ${today()}`]);
  expect(files[0]!.copyRequiresWriterPermission).toBe(true);

  const exp = await db.driveExport.findMany({
    where: { projectId: ctx.projectId, docType: "BUDGET" },
    select: { docId: true, externalId: true, statusLabel: true, version: true },
  });
  expect(exp).toEqual([{ docId: ctx.departmentId, externalId: files[0]!.id, statusLabel: "на утверждении", version: null }]);

  // Доступы папки выдаются после ответа (`after()`).
  await expect
    .poll(async () => {
      const state = await stub<StubState>("/state");
      return state.google.permissions
        .filter((p) => p.fileId === folder)
        .map((p) => p.emailAddress)
        .sort();
    }, { timeout: 30_000 })
    .toEqual([email("nofin"), email("producer")].sort());
  await context.close();
});

test("повторно — тот же файл, новое имя; «Уже на диске»", async ({ browser }) => {
  await db.budget.update({ where: { id: budgetId! }, data: { status: "DRAFT" } });
  const { context, page } = await openAs(browser, "producer");
  const dialog = await openDriveDialog(page);
  await expect(dialog.getByTestId("budget-drive-existing")).toContainText("на утверждении");
  await expect(dialog.getByTestId("budget-drive-keeper-hint")).toHaveCount(0);
  const before = (await db.driveExport.findFirstOrThrow({ where: { docType: "BUDGET", projectId: ctx.projectId } })).externalId;
  expect(await clickUpload(dialog)).toContain("ссылка прежняя");
  const after = await db.driveExport.findFirstOrThrow({ where: { docType: "BUDGET", projectId: ctx.projectId } });
  expect(after.externalId).toBe(before);
  const { google } = await stub<StubState>("/state");
  const file = google.files.find((f) => f.id === before)!;
  expect(file.name).toBe(`Смета · Транспортный цех · черновик · ${today()}`);
  expect(file.copyRequiresWriterPermission).toBe(true);
  await context.close();
});

test("две вкладки сразу — один файл", async ({ browser }) => {
  // Забыть выгрузку в базе: обе вкладки хотят создать файл, вторая ждёт блокировку и видит первую.
  const folder = await folderExternalId(budgetKey());
  await db.driveExport.deleteMany({ where: { projectId: ctx.projectId, docType: "BUDGET" } });
  const countBefore = (await stub<StubState>("/state")).google.files.filter((f) => f.parents.includes(folder!)).length;

  const { context, page } = await openAs(browser, "producer");
  const second = await context.newPage();
  const [d1, d2] = [await openDriveDialog(page), await openDriveDialog(second)];
  const [t1, t2] = await Promise.all([clickUpload(d1), clickUpload(d2)]);
  expect([t1, t2].some((t) => t.includes("Смета выгружена на диск проекта"))).toBe(true);
  expect([t1, t2].some((t) => t.includes("ссылка прежняя"))).toBe(true);

  const rows = await db.driveExport.findMany({ where: { projectId: ctx.projectId, docType: "BUDGET" } });
  expect(rows).toHaveLength(1);
  const files = (await stub<StubState>("/state")).google.files.filter((f) => f.parents.includes(folder!));
  expect(files.length).toBe(countBefore + 1);
  await context.close();
});

test("глава чужого цеха: страницы и кнопки нет, прямой запрос — «Недостаточно прав», в заглушку ничего не ушло", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "nocallsheet");
  const res = await page.goto(smetaPath());
  expect(res?.status()).toBe(404);
  await context.close();

  // Окно открыто продюсером, запрос уходит с сессией главы другого цеха.
  const prod = await openAs(browser, "producer");
  const dialog = await openDriveDialog(prod.page);
  const writes = await fileWrites();
  await switchSession(prod.context, "nocallsheet");
  expect(await clickUpload(dialog)).toBe("Недостаточно прав");
  expect(await fileWrites()).toBe(writes);
  await prod.context.close();
});

test("«Сметы — просмотр всех»: смету видит, кнопки «На диск…» нет, прямой запрос — «Недостаточно прав»", async ({
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
  await db.departmentHead.deleteMany({ where: { membershipId: memberships.nocallsheet } });
  await db.projectMembership.update({ where: { id: memberships.nocallsheet }, data: { roleId: readAllRoleId } });

  const { context, page } = await openAs(browser, "nocallsheet");
  await page.goto(smetaPath());
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

test("в папках вызывных файлов смет нет; все файлы смет — в папке цеха смет", async () => {
  const { google } = await stub<StubState>("/state");
  const budgetFolder = await folderExternalId(budgetKey());
  const budgetFiles = google.files.filter((f) => f.name.startsWith("Смета"));
  expect(budgetFiles.length).toBeGreaterThan(0);
  for (const f of budgetFiles) expect(f.parents).toEqual([budgetFolder]);
  const callSheetFolders = await db.driveFolder.findMany({
    where: { projectId: ctx.projectId, key: { in: ["callsheets", "common", "departments"] } },
    select: { externalId: true },
  });
  const csIds = new Set(callSheetFolders.map((f) => f.externalId));
  expect(budgetFiles.some((f) => f.parents.some((p) => csIds.has(p)))).toBe(false);
});

test("журнал: «Выгрузка смет» без сумм, ссылок и почт; роль без «просмотр всех» этих записей не видит", async ({
  browser,
}) => {
  const rows = await db.auditLog.findMany({
    where: { projectId: ctx.projectId, entityType: "smeta_export", summary: { contains: "на диск проекта" } },
    select: { summary: true, changes: true },
  });
  expect(rows.length).toBeGreaterThanOrEqual(3);
  expect(rows.map((r) => r.summary)).toContain(
    "Смета цеха «Транспортный цех» выгружена на диск проекта: текущий лист (на утверждении)",
  );
  const text = JSON.stringify(rows);
  expect(text).not.toContain(MONEY.budgetRate.split(".")[0]);
  expect(text).not.toMatch(/https?:|@/);

  const producer = await openAs(browser, "producer");
  await producer.page.goto(projectPath(ctx, "/audit"));
  await expect(producer.page.getByText("выгружена на диск проекта").first()).toBeVisible({ timeout: 90_000 });
  await producer.context.close();

  // «Без финансов» видит вызывные, но не «Сметы — просмотр всех» (и он глава — это не меняет журнал).
  const nofin = await openAs(browser, "nofin");
  await nofin.page.goto(projectPath(ctx, "/audit"));
  await expect(nofin.page.getByRole("heading").first()).toBeVisible({ timeout: 90_000 });
  await expect(nofin.page.getByText("выгружена на диск проекта")).toHaveCount(0);
  await nofin.context.close();
});
