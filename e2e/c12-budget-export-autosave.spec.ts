import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ROLES, MONEY, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";
import { MAIN_HEADERS } from "../src/features/smeta/lib/main-sheet";

/**
 * Досохранение перед «Экспорт Excel» и «На диск…» (`BUDGET_DRIVE_NOTES.md`, шаг 7): без правок
 * главы выгрузка ничего не сохраняет, даже если Univer при открытии пересчитал формулы и значения
 * разошлись с сохранёнными (смета «на утверждении» остаётся «на утверждении»); с правкой — правка
 * досохраняется, смета — черновик. Смета создаётся прямо в базе, всё возвращается после прогона.
 * «На диск…» — против заглушки дисков; без `E2E_CLOUD_STUB_URL` — пропуск.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();

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

const smetaPath = () => projectPath(ctx, `/smeta/${ctx.departmentId}`);

/** Сумма и Итого статьи сида: 2 × ставка × 1 день, налог 0 %. */
const TOTAL = Math.round(Number(MONEY.budgetRate) * 2 * 100) / 100;

/**
 * Статья сида целиком (как в c10) и справа, вне колонок сметы, две формулы, которые Univer при
 * открытии считает заново: СЕГОДНЯ() и «Кол-во × 3» с сохранённым 0 (у Univer 0 — «не посчитано»).
 * После пересчёта книга в памяти отличается от сохранённой — правкой это не считается.
 */
function mainSheetData() {
  return {
    id: "main",
    name: "Основной",
    cellData: {
      0: Object.fromEntries(MAIN_HEADERS.map((h, i) => [i, { v: h, t: 1 }])),
      1: {
        0: { v: "TR-01.01", t: 1 },
        1: { v: "Спецтехника", t: 1 },
        2: { v: "смена", t: 1 },
        3: { v: 2, t: 2 },
        4: { v: Number(MONEY.budgetRate), t: 2 },
        5: { v: 1, t: 2 },
        6: { v: TOTAL, t: 2, f: "=D2*E2*F2" },
        7: { v: 0, t: 2 },
        8: { v: 0, t: 2, f: "=G2*H2/100" },
        9: { v: TOTAL, t: 2, f: "=G2+I2" },
        11: { v: 0, t: 2, f: "=TODAY()" },
        12: { v: 0, t: 2, f: "=D2*3" },
      },
    },
    columnData: { 1: { w: 220 } },
  };
}

const loadItems = () =>
  db.budgetItem.findMany({
    where: { projectId: ctx.projectId, departmentId: ctx.departmentId },
    orderBy: { id: "asc" },
  });
let itemsBefore: Awaited<ReturnType<typeof loadItems>> = [];
let budgetId: string | null = null;
let producerMembership = "";
let nofinMembership = "";
let previousHeads: { departmentId: string; membershipId: string }[] = [];

const budgetState = () =>
  db.budget.findUniqueOrThrow({
    where: { id: budgetId! },
    select: { status: true, revision: true, changedAfterSubmitAt: true },
  });
/** Сохранённый основной лист (JSON Univer) как строка. */
const mainSheetJson = async () =>
  JSON.stringify(
    (
      await db.budgetSheet.findFirstOrThrow({
        where: { budgetId: budgetId!, sheetKey: "main" },
        select: { data: { select: { data: true } } },
      })
    ).data?.data ?? null,
  );

/** Открыть смету главой и дождаться редактора и пересчёта формул после загрузки. */
async function openEditor(page: Page) {
  await page.goto(smetaPath());
  await expect(page.getByRole("button", { name: "На диск…" })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  // Univer пересчитывает формулы асинхронно уже после загрузки (без события на странице):
  // ждём заведомо дольше, чтобы выгрузка пошла от пересчитанной книги.
  await page.waitForTimeout(3_000);
}

async function exportExcel(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Экспорт Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Смета · Транспортный цех · /);
  return download.suggestedFilename();
}

async function uploadToDrive(page: Page) {
  await page.getByRole("button", { name: "На диск…" }).click();
  const dialog = page.getByRole("dialog", { name: "Смета на диск" });
  await expect(dialog.getByTestId("budget-drive-audience")).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", { name: /^Выгрузить/ }).click();
  const result = dialog.locator('[data-testid="budget-drive-done"], [role="alert"]');
  await expect(result.first()).toBeVisible({ timeout: 60_000 });
  const text = (await result.first().innerText()).trim();
  await page.keyboard.press("Escape");
  return text;
}

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — «На диск…» проверяется только на заглушке");

test.beforeAll(async () => {
  const existing = await db.budget.findFirst({ where: { departmentId: ctx.departmentId }, select: { id: true } });
  test.skip(!!existing, "У транспортного цеха тестового проекта уже есть смета — тест её не трогает");

  itemsBefore = await loadItems();
  const member = (role: E2ERoleKey) =>
    db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, user: { email: E2E_ROLES[role].email } },
      select: { id: true },
    });
  producerMembership = (await member("producer")).id;
  nofinMembership = (await member("nofin")).id;
  previousHeads = await db.departmentHead.findMany({
    where: { departmentId: ctx.departmentId },
    select: { departmentId: true, membershipId: true },
  });
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: nofinMembership } });

  const budget = await db.budget.create({
    data: { projectId: ctx.projectId, departmentId: ctx.departmentId, status: "SUBMITTED", styles: {} },
  });
  budgetId = budget.id;
  const main = await db.budgetSheet.create({
    data: { budgetId, sheetKey: "main", name: "Основной", sortOrder: 0, data: { create: { data: mainSheetData() } } },
  });
  await db.budget.update({ where: { id: budgetId }, data: { mainSheetId: main.id } });

  await fetch(`${STUB}/__stub/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  helper("connect", ctx.projectId, producerMembership);
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
  if (previousHeads.length) await db.departmentHead.createMany({ data: previousHeads });
  // Статьи цеха — как до прогона (правка во втором тесте пересохраняет основной лист).
  for (const { id, ...values } of itemsBefore) await db.budgetItem.update({ where: { id }, data: values });
  await db.$disconnect();
});

test("глава без правок: «Экспорт Excel» и «На диск…» ничего не сохраняют — смета остаётся «на утверждении»", async ({
  browser,
}) => {
  const sheetBefore = await mainSheetJson();
  const { context, page } = await openAs(browser, "nofin");
  await openEditor(page);

  await exportExcel(page);
  expect(await uploadToDrive(page)).toContain("Смета выгружена на диск проекта");
  // Выгрузка на диск — с меткой «на утверждении»: файл собран из несброшенной сметы.
  expect(
    (await db.driveExport.findFirstOrThrow({ where: { projectId: ctx.projectId, docType: "BUDGET" } })).statusLabel,
  ).toBe("на утверждении");

  expect(await budgetState()).toEqual({ status: "SUBMITTED", revision: 0, changedAfterSubmitAt: null });
  expect(await mainSheetJson()).toBe(sheetBefore);
  expect(await loadItems()).toEqual(itemsBefore);
  const edits = await db.auditLog.count({
    where: { projectId: ctx.projectId, entityType: "budget", entityId: budgetId!, action: "UPDATE" },
  });
  expect(edits).toBe(0);
  await context.close();
});

test("глава правит ячейку: «Экспорт Excel» досохраняет правку, смета — черновик", async ({ browser }) => {
  const { context, page } = await openAs(browser, "nofin");
  await openEditor(page);

  // Правка вне колонок сметы (ячейка M2 с формулой «Кол-во × 3») — статьи от неё не меняются.
  // Клик по A2 на холсте Univer (шапка колонок ~20 px, номера строк ~46 px, строка 24 px), дальше —
  // стрелками вправо до M2.
  const canvas = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLCanvasElement>(".univer-smeta-host canvas")]
      .map((c) => c.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height);
    return boxes[0] ? { x: boxes[0].x, y: boxes[0].y } : null;
  });
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + 90, canvas!.y + 56);
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type("77");
  await page.keyboard.press("Enter");

  await exportExcel(page);
  const state = await budgetState();
  expect(state.status).toBe("DRAFT");
  expect(state.revision).toBe(1);
  expect(state.changedAfterSubmitAt).not.toBeNull();
  const sheet = JSON.parse(await mainSheetJson()) as { cellData: Record<string, Record<string, { v?: unknown; f?: string }>> };
  // M2: введённое число вместо формулы.
  expect(Number(sheet.cellData["1"]?.["12"]?.v)).toBe(77);
  expect(sheet.cellData["1"]?.["12"]?.f || null).toBeNull();
  await context.close();
});
