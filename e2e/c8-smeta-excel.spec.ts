import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { E2E_ROLES, MONEY, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";
import { MAIN_HEADERS } from "../src/features/smeta/lib/main-sheet";

/**
 * «Экспорт Excel» сметы цеха (`BUDGET_DRIVE_NOTES.md`, шаг 2): в файле только основной лист и
 * «О выгрузке», черновых листов и формул нет; глава чужого цеха получает отказ сервера.
 * Смета создаётся прямо в базе (основной лист со статьёй TR-01.01 из сида + черновой лист) и
 * удаляется после прогона; главы цехов возвращаются как были.
 */

const ctx = e2eContext();
const db = e2eDb();
const OTHER_DEPT = "E2E Звук (Excel)";
const DRAFT_MARK = "ЧЕРНОВОЙ-РАСЧЁТ-НЕ-ВЫГРУЖАТЬ";

let budgetId: string | null = null;
let otherDeptId: string;
let previousHeads: { departmentId: string; membershipId: string }[] = [];

async function membershipOf(role: E2ERoleKey) {
  return db.projectMembership.findFirstOrThrow({
    where: { projectId: ctx.projectId, user: { email: E2E_ROLES[role].email } },
    select: { id: true },
  });
}

/** Сессия другой роли в уже открытом окне: дальше запросы уходят с её куками. */
async function switchSession(context: BrowserContext, role: E2ERoleKey) {
  const { cookies } = JSON.parse(readFileSync(storageStatePath(role), "utf8")) as {
    cookies: Parameters<BrowserContext["addCookies"]>[0];
  };
  await context.clearCookies();
  await context.addCookies(cookies);
}

async function openAs(browser: Browser, role: E2ERoleKey) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

function lastSmetaExport() {
  return db.auditLog.findFirst({
    where: { projectId: ctx.projectId, entityType: "smeta_export" },
    orderBy: { createdAt: "desc" },
    select: { id: true, summary: true, changes: true },
  });
}

/** Основной лист: шапка, статья TR-01.01 (строка 1, как `sortOrder` статьи сида) с формулами. */
function mainSheetData() {
  return {
    id: "main",
    name: "Основной",
    cellData: {
      0: Object.fromEntries(MAIN_HEADERS.map((h, i) => [i, { v: h, t: 1 }])),
      1: {
        0: { v: "TR-01.01", t: 1 },
        1: { v: "Спецтехника", t: 1 },
        3: { v: 2, t: 2 },
        4: { v: Number(MONEY.budgetRate), t: 2 },
        5: { v: 1, t: 2 },
        6: { v: 0, t: 2, f: "=D2*E2*F2" },
        8: { v: 0, t: 2, f: "=G2*H2/100" },
        9: { v: 0, t: 2, f: "=G2+I2" },
      },
    },
    columnData: { 1: { w: 220 } },
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const existing = await db.budget.findFirst({ where: { departmentId: ctx.departmentId }, select: { id: true } });
  test.skip(!!existing, "У транспортного цеха тестового проекта уже есть смета — тест её не трогает");

  const [nofin, nocallsheet] = await Promise.all([membershipOf("nofin"), membershipOf("nocallsheet")]);
  previousHeads = await db.departmentHead.findMany({
    where: { departmentId: ctx.departmentId },
    select: { departmentId: true, membershipId: true },
  });
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  // Глава транспортного цеха — роль без финансов; глава другого цеха — роль без вызывных.
  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: nofin.id } });
  const other = await db.department.create({
    data: { projectId: ctx.projectId, name: OTHER_DEPT, codePrefix: "ZXL" },
  });
  otherDeptId = other.id;
  await db.departmentHead.create({ data: { departmentId: otherDeptId, membershipId: nocallsheet.id } });

  const budget = await db.budget.create({
    data: { projectId: ctx.projectId, departmentId: ctx.departmentId, status: "SUBMITTED", styles: {} },
  });
  budgetId = budget.id;
  const main = await db.budgetSheet.create({
    data: { budgetId, sheetKey: "main", name: "Основной", sortOrder: 0, data: { create: { data: mainSheetData() } } },
  });
  await db.budgetSheet.create({
    data: {
      budgetId,
      sheetKey: "draft",
      name: "Черновые расчёты",
      sortOrder: 1,
      data: {
        create: {
          data: {
            id: "draft",
            name: "Черновые расчёты",
            cellData: { 0: { 0: { v: DRAFT_MARK, t: 1 }, 1: { v: 5, t: 2, f: "=2+3" } } },
          },
        },
      },
    },
  });
  await db.budget.update({ where: { id: budgetId }, data: { mainSheetId: main.id } });
});

test.afterAll(async () => {
  if (budgetId) {
    await db.budget.update({ where: { id: budgetId }, data: { mainSheetId: null } });
    await db.budgetSheet.deleteMany({ where: { budgetId } });
    await db.budget.delete({ where: { id: budgetId } });
    await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
    if (previousHeads.length) await db.departmentHead.createMany({ data: previousHeads });
  }
  if (otherDeptId) {
    await db.departmentHead.deleteMany({ where: { departmentId: otherDeptId } });
    await db.department.delete({ where: { id: otherDeptId } });
  }
  await db.$disconnect();
});

test("глава цеха без финансов: в Excel — основной лист и «О выгрузке», без черновых листов и формул", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "nofin");
  await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
  const button = page.getByRole("button", { name: "Экспорт Excel" });
  await expect(button).toBeVisible({ timeout: 90_000 });
  const before = await lastSmetaExport();

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^smeta-TR-draft-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync((await download.path())!) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);

  expect(book.worksheets.map((s) => s.name)).toEqual(["Основной", "О выгрузке"]);
  const texts: string[] = [];
  for (const sheet of book.worksheets) {
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        expect(cell.type, `${sheet.name}!${cell.address}`).not.toBe(ExcelJS.ValueType.Formula);
        texts.push(String(cell.value));
      }),
    );
  }
  expect(texts.join("\n")).not.toContain(DRAFT_MARK);
  const main = book.getWorksheet("Основной")!;
  expect(main.getCell("A2").value).toBe("TR-01.01");
  // Итого статьи — серверный расчёт (статья сида: 2 × ставка), а не 0 из ячейки с формулой.
  expect(main.getCell("J2").value).toBe(Number(MONEY.budgetRate) * 2);
  const info = book.getWorksheet("О выгрузке")!;
  expect(info.getCell("B1").value).toBe("Смета цеха «Транспортный цех»");
  expect(info.getCell("B3").value).toBe("на утверждении");
  expect(info.getCell("B5").value).toBe(E2E_ROLES.nofin.name);

  const audit = await lastSmetaExport();
  expect(audit?.id).not.toBe(before?.id);
  expect(audit?.summary).toBe("Выгрузка сметы цеха «Транспортный цех» в Excel: текущий лист (на утверждении)");
  const changes = JSON.stringify(audit?.changes);
  expect(changes).not.toContain(MONEY.budgetRate.split(".")[0]);
  await context.close();
});

test("глава чужого цеха: сервер отказывает, файла и записи в журнале нет", async ({ browser }) => {
  // Окно открыто продюсером (кнопка есть), запрос уходит с сессией главы другого цеха.
  const { context, page } = await openAs(browser, "producer");
  await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
  const button = page.getByRole("button", { name: "Экспорт Excel" });
  await expect(button).toBeVisible({ timeout: 90_000 });
  const before = await lastSmetaExport();
  await switchSession(context, "nocallsheet");

  let downloaded = false;
  page.on("download", () => void (downloaded = true));
  await button.click();
  await expect(page.getByText("Недостаточно прав")).toBeVisible();
  expect(downloaded).toBe(false);
  expect((await lastSmetaExport())?.id).toBe(before?.id);

  // Сама страница сметы чужого цеха для него — «не найдено».
  const res = await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
  expect(res?.status()).toBe(404);
  await context.close();
});
