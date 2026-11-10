import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { E2E_ROLES, MONEY, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";
import { createItemsLine, deleteItemsRun } from "./helpers/smeta-items";

/**
 * Досохранение перед «Экспорт Excel» и «На диск…» (`BUDGET_DRIVE_NOTES.md`, шаг 7) в смете по
 * статьям: без правок главы выгрузка ничего не сохраняет (смета «на утверждении» остаётся «на
 * утверждении»); с несохранённой правкой строки — правка досохраняется до выгрузки, смета —
 * черновик, в файле уже новое значение. Смета создаётся прямо в базе и удаляется после прогона.
 * «На диск…» — против заглушки дисков; без `E2E_CLOUD_STUB_URL` — пропуск.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const RUN = `as${Date.now().toString(36)}`;
const LINE = { name: `Спецтехника ${RUN}`, unit: "смена", quantity: 2, rate: Number(MONEY.budgetRate), taxPercent: 0 };

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

let budgetId: string | null = null;
let created: Awaited<ReturnType<typeof createItemsLine>> | null = null;
let nofinMembership = "";
let producerMembership = "";
let previousHeads: { departmentId: string; membershipId: string }[] = [];

const budgetState = () =>
  db.budget.findUniqueOrThrow({
    where: { id: budgetId! },
    select: { status: true, revision: true, changedAfterSubmitAt: true },
  });
const lineRate = async () => (await db.budgetItem.findUniqueOrThrow({ where: { id: created!.itemId } })).rate?.toString();

async function openSmeta(page: Page) {
  await page.goto(smetaPath());
  await expect(page.locator(`tr[data-budget-line="${LINE.name}"]`)).toBeVisible({ timeout: 90_000 });
}

/** «Экспорт Excel» → окно колонок → файл; значения листа «Смета». */
async function exportExcel(page: Page) {
  await page.getByRole("button", { name: "Экспорт Excel" }).click();
  const dialog = page.getByRole("dialog", { name: "Экспорт сметы в Excel" });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    dialog.getByRole("button", { name: "Экспортировать Excel" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Смета · Транспортный цех · /);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync((await download.path())!) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  return book.getWorksheet("Смета")!;
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
  created = await createItemsLine(db, { projectId: ctx.projectId, departmentId: ctx.departmentId, budgetId, run: RUN, line: LINE });

  await fetch(`${STUB}/__stub/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  helper("connect", ctx.projectId, producerMembership);
});

test.afterAll(async () => {
  if (!STUB) return;
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await deleteItemsRun(db, ctx.projectId, RUN);
  if (budgetId) {
    await db.budgetSheet.deleteMany({ where: { budgetId } });
    await db.budget.delete({ where: { id: budgetId } });
  }
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  if (previousHeads.length) await db.departmentHead.createMany({ data: previousHeads });
  await db.$disconnect();
});

test("глава без правок: «Экспорт Excel» и «На диск…» ничего не сохраняют — смета остаётся «на утверждении»", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "nofin");
  await openSmeta(page);

  const sheet = await exportExcel(page);
  expect(sheet.getCell("A4").value).toBe(created!.code);
  expect(await uploadToDrive(page)).toContain("Смета выгружена на диск проекта");
  // Выгрузка на диск — с меткой «на утверждении»: файл собран из несброшенной сметы.
  expect(
    (await db.driveExport.findFirstOrThrow({ where: { projectId: ctx.projectId, docType: "BUDGET" } })).statusLabel,
  ).toBe("на утверждении");

  expect(await budgetState()).toEqual({ status: "SUBMITTED", revision: 0, changedAfterSubmitAt: null });
  expect(await lineRate()).toBe(String(LINE.rate));
  const edits = await db.auditLog.count({
    where: { projectId: ctx.projectId, entityType: "budget", entityId: budgetId!, action: "UPDATE" },
  });
  expect(edits).toBe(0);
  await context.close();
});

test("глава правит строку и сразу «Экспорт Excel»: правка досохраняется, в файле новое значение, смета — черновик", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "nofin");
  await openSmeta(page);
  await page.locator(`tr[data-budget-line="${LINE.name}"]`).getByLabel("Ставка").fill("777");

  const sheet = await exportExcel(page);
  expect(sheet.getCell("F4").value).toBe(777);
  expect(sheet.getCell("L4").value).toBe(1554);
  expect(await lineRate()).toBe("777");
  const state = await budgetState();
  expect(state.status).toBe("DRAFT");
  expect(state.revision).toBe(1);
  expect(state.changedAfterSubmitAt).not.toBeNull();
  await context.close();
});
