import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { E2E_ROLES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { findLeaks, workbookText } from "./helpers/leaks";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Выгрузка вызывного на личный диск — против заглушки дисков (`e2e/cloud-stub`), не против
 * настоящих Google и Яндекса. Нужен dev-сервер, запущенный с адресами заглушки:
 *   CLOUD_STUB_GOOGLE_URL=<заглушка>/google CLOUD_STUB_YANDEX_URL=<заглушка>/yandex
 *   APP_URL=<адрес dev-сервера> DRIVE_EXPORT_DEADLINE_MS=20000   (конфигурация `dev-cloud-stub`)
 * и `E2E_CLOUD_STUB_URL=<заглушка>` у прогона (globalSetup поднимет заглушку, если её нет).
 * Без `E2E_CLOUD_STUB_URL` тесты пропускаются: на сервере владельца — настоящие диски.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();

/** Предел ожидания диска у dev-сервера (`DRIVE_EXPORT_DEADLINE_MS`). */
const DEADLINE_MS = 20_000;

type StubFile = { id: string; name: string; mimeType: string; parents: string[]; trashed: boolean; contentVersion: number };
type StubState = {
  google: { files: StubFile[] };
  yandex: { resources: Array<{ path: string; type: string; contentVersion: number }>; published: unknown[] };
};

async function stub<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STUB}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status, `заглушка ${path}`).toBe(200);
  return (await res.json()) as T;
}

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const sheets = async (dayNumber?: number) =>
  (await stub<StubState>("/state")).google.files.filter(
    (f) => f.mimeType === SHEET_MIME && !f.trashed && (dayNumber === undefined || f.name.includes(`день ${dayNumber} ·`)),
  );

const userId = async (role: E2ERoleKey) =>
  (await db.user.findUniqueOrThrow({ where: { email: E2E_ROLES[role].email }, select: { id: true } })).id;

/** Запись выгрузки дня этого человека на этот диск (или null). */
async function exportRow(role: E2ERoleKey, dayNumber: number, provider: "GOOGLE_DRIVE" | "YANDEX_DISK") {
  return db.driveExport.findFirst({
    where: {
      projectId: ctx.projectId,
      docId: dayId(ctx, dayNumber),
      provider,
      folder: { cloudConnection: { userId: await userId(role) } },
    },
    select: { externalId: true, uploadedAt: true, version: true, statusLabel: true },
  });
}

/** Подключить личные диски через «Профиль» (заглушка сразу возвращает код). */
async function connectDrives(browser: Browser, role: E2ERoleKey, providers: ("GOOGLE_DRIVE" | "YANDEX_DISK")[]) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  const page = await context.newPage();
  for (const provider of providers) {
    await page.goto("/ru/profile");
    const card = page.getByTestId(`cloud-connection-${provider}`);
    await card.getByRole("button", { name: /Подключить|Переподключить/ }).click();
    await expect(page.getByTestId("cloud-oauth-notice")).toContainText("подключён");
  }
  await context.close();
}

async function openDriveDialog(page: Page, dayNumber: number): Promise<Locator> {
  await page.goto(projectPath(ctx, `/call-sheets/${dayId(ctx, dayNumber)}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  await page.getByRole("menuitem", { name: "На диск…" }).click();
  const dialog = page.getByRole("dialog", { name: "Вызывной на диск" });
  await expect(dialog.getByText("Куда")).toBeVisible();
  return dialog;
}

async function pickVersion(page: Page, dialog: Locator, label: RegExp) {
  await dialog.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole("option", { name: label }).click();
}

/** Нажать «Выгрузить» и дождаться итога: текст «готово» или ошибки. */
async function upload(dialog: Locator, provider: "Google" | "Яндекс" = "Google") {
  await dialog.getByRole("radio", { name: new RegExp(`Мой ${provider}`) }).check();
  await dialog.getByRole("button", { name: /^Выгрузить/ }).click();
  const result = dialog.locator('[data-testid="drive-export-done"], [role="alert"]');
  await expect(result.first()).toBeVisible({ timeout: 60_000 });
  return (await result.first().innerText()).trim();
}

/** Варианты версии дня так, как их показывает окно: «Текущая» (не утверждён) и утверждённые. */
async function versionLabels(dayNumber: number): Promise<RegExp[]> {
  const sheet = await db.callSheet.findFirst({
    where: { projectId: ctx.projectId, shootDayId: dayId(ctx, dayNumber) },
    select: { status: true, approvedVersions: { select: { version: true }, orderBy: { version: "desc" } } },
  });
  const out: RegExp[] = [];
  if (sheet?.status !== "APPROVED") out.push(/^Текущая/);
  for (const v of sheet?.approvedVersions ?? []) out.push(new RegExp(`^Версия ${v.version} ·`));
  return out;
}

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — выгрузка на диск проверяется только на заглушке");
test.use({ storageState: storageStatePath("producer") });

test.beforeAll(async ({ browser }) => {
  await stub("/reset", {});
  // Подключения тестовых пользователей — с чистого листа (папки и выгрузки уходят каскадом).
  const emails = Object.values(E2E_ROLES).map((r) => r.email);
  await db.cloudConnection.deleteMany({ where: { user: { email: { in: emails } } } });
  await connectDrives(browser, "producer", ["GOOGLE_DRIVE", "YANDEX_DISK"]);
  await connectDrives(browser, "nofin", ["GOOGLE_DRIVE"]);
});

test.afterAll(async () => {
  await db.$disconnect();
});

test("первая выгрузка: папки PELENA · Проект / Вызывные, Google Таблица, ссылка", async ({ page }) => {
  const dialog = await openDriveDialog(page, 1);
  expect(await upload(dialog)).toContain("Вызывной выгружен на Google Диск");
  await expect(dialog.getByRole("button", { name: "Копировать ссылку" })).toBeVisible();

  const state = await stub<StubState>("/state");
  const root = state.google.files.find((f) => f.name === "PELENA · E2E приёмка");
  const folder = state.google.files.find((f) => f.name === "Вызывные" && f.parents.includes(root?.id ?? "-"));
  expect(root && folder).toBeTruthy();
  const [sheet] = await sheets(1);
  expect(sheet.parents).toEqual([folder!.id]);
  expect(sheet.name).toMatch(/^Вызывной · день 1 · \d\d\.\d\d\.\d{4}( · версия \d+)? \((черновик|на согласовании|утверждён)\)$/);
  expect((await exportRow("producer", 1, "GOOGLE_DRIVE"))?.externalId).toBe(sheet.id);
});

test("две выгрузки одновременно (две вкладки) → один файл", async ({ page, context }) => {
  const second = await context.newPage();
  const [a, b] = await Promise.all([openDriveDialog(page, 2), openDriveDialog(second, 2)]);
  const results = await Promise.all([upload(a), upload(b)]);
  expect(results.sort()).toEqual([
    expect.stringContaining("Вызывной выгружен на Google Диск"),
    expect.stringContaining("Файл на Google Диске обновлён — ссылка прежняя"),
  ]);
  const files = await sheets(2);
  expect(files).toHaveLength(1);
  expect(files[0].contentVersion).toBe(2);
  await second.close();
});

test("повторная выгрузка другой версии: тот же файл, новое имя", async ({ page }) => {
  // День, где у окна есть хотя бы два варианта версии (текущая + утверждённая или две утверждённые).
  let dayNumber = 0;
  let labels: RegExp[] = [];
  for (const d of [2, 1]) {
    labels = await versionLabels(d);
    if (labels.length >= 2) {
      dayNumber = d;
      break;
    }
  }
  expect(dayNumber, "нужен день с утверждённой версией (c1-flows утверждает вызывной)").toBeGreaterThan(0);

  const dialog = await openDriveDialog(page, dayNumber);
  await pickVersion(page, dialog, labels[0]);
  await upload(dialog);
  const [before] = await sheets(dayNumber);

  await pickVersion(page, dialog, labels[1]);
  expect(await upload(dialog)).toContain("ссылка прежняя");
  const after = await sheets(dayNumber);
  expect(after).toHaveLength(1);
  expect(after[0].id).toBe(before.id);
  expect(after[0].name).not.toBe(before.name);
  expect(after[0].contentVersion).toBe(before.contentVersion + 1);
});

test("файл удалили на диске (404) → создан новый, сообщение", async ({ page }) => {
  const [old] = await sheets(1);
  await stub(`/google/files/${old.id}/delete`, {});
  const dialog = await openDriveDialog(page, 1);
  expect(await upload(dialog)).toContain("создан новый файл, ссылка новая");
  const files = await sheets(1);
  expect(files).toHaveLength(1);
  expect(files[0].id).not.toBe(old.id);
  expect((await exportRow("producer", 1, "GOOGLE_DRIVE"))?.externalId).toBe(files[0].id);
});

test("медленный Google (12 с) — выгрузка проходит", async ({ page }) => {
  await stub("/config", { failNext: [{ provider: "google", match: "files.update", delayMs: 12_000 }] });
  const dialog = await openDriveDialog(page, 1);
  const started = Date.now();
  expect(await upload(dialog)).toContain("ссылка прежняя");
  expect(Date.now() - started).toBeGreaterThan(11_000);
});

test("Google дольше предела — понятная ошибка, запись выгрузки не меняется", async ({ page }) => {
  const before = await exportRow("producer", 1, "GOOGLE_DRIVE");
  await stub("/config", { failNext: [{ provider: "google", match: "files.update", delayMs: DEADLINE_MS + 8_000 }] });
  const dialog = await openDriveDialog(page, 1);
  expect(await upload(dialog)).toContain("Диск отвечает слишком долго");
  expect(await exportRow("producer", 1, "GOOGLE_DRIVE")).toEqual(before);

  // Блокировка отпущена: следующая выгрузка идёт сразу и пишет запись.
  await page.waitForTimeout(9_000);
  expect(await upload(dialog)).toContain("ссылка прежняя");
  const now = await exportRow("producer", 1, "GOOGLE_DRIVE");
  expect(now?.externalId).toBe(before?.externalId);
  expect(now!.uploadedAt.getTime()).toBeGreaterThan(before!.uploadedAt.getTime());
});

test("Яндекс: .xlsx в папке приложения «<Проект> · <id>/Вызывные», без публичной ссылки", async ({ page }) => {
  const dialog = await openDriveDialog(page, 1);
  await dialog.getByRole("radio", { name: /Мой Яндекс/ }).check();
  await expect(dialog.getByText("файл увидите только вы")).toBeVisible();
  expect(await upload(dialog, "Яндекс")).toContain("Вызывной выгружен на Яндекс Диск");

  const state = await stub<StubState>("/state");
  const folder = `app:/E2E приёмка · ${ctx.projectId.slice(-6)}/Вызывные/`;
  const files = state.yandex.resources.filter((r) => r.type === "file");
  expect(files).toHaveLength(1);
  expect(files[0].path.startsWith(folder)).toBe(true);
  expect(files[0].path).toMatch(/Вызывной · день 1 · .+\.xlsx$/);
  expect(state.yandex.published).toHaveLength(0);
});

test("роль без «КПП и вызывные: просмотр» — сервер отказывает", async ({ page, context }) => {
  const dialog = await openDriveDialog(page, 1);
  const filesBefore = (await stub<StubState>("/state")).google.files.length;
  // Окно открыто продюсером; дальше запросы уходят с сессией роли без вызывных.
  const { cookies } = JSON.parse(readFileSync(storageStatePath("nocallsheet"), "utf8")) as {
    cookies: Parameters<typeof context.addCookies>[0];
  };
  await context.clearCookies();
  await context.addCookies(cookies);
  expect(await upload(dialog)).toContain("Недостаточно прав");
  expect((await stub<StubState>("/state")).google.files.length).toBe(filesBefore);
  expect(await exportRow("nocallsheet", 1, "GOOGLE_DRIVE")).toBeNull();
});

test("без финансов: в отправленный на диск файл не попадают деньги", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStatePath("nofin") });
  const page = await context.newPage();
  const dialog = await openDriveDialog(page, 1);
  expect(await upload(dialog)).toContain("Вызывной выгружен на Google Диск");
  await context.close();

  const row = await exportRow("nofin", 1, "GOOGLE_DRIVE");
  expect(row).not.toBeNull();
  const res = await fetch(`${STUB}/__stub/google/files/${row!.externalId}/content`);
  expect(res.status).toBe(200);
  const text = await workbookText(Buffer.from(await res.arrayBuffer()));
  expect(text).toContain("E2E приёмка"); // книга прочиталась, это вызывной проекта
  expect(findLeaks("файл на диске (без финансов)", text)).toEqual([]);
});
