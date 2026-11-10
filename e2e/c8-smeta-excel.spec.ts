import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { E2E_ROLES, MONEY, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";
import { createItemsLine, deleteItemsRun } from "./helpers/smeta-items";

/**
 * «Экспорт Excel» сметы цеха: в файле смета по статьям (уровни, колонка «Код», суммы) и
 * «О выгрузке», листов-черновиков и формул нет; глава чужого цеха получает отказ сервера.
 * Смета создаётся прямо в базе (статья, подстатья, строка + лист-черновик) и удаляется после
 * прогона; главы цехов возвращаются как были.
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

const RUN = `xl${Date.now().toString(36)}`;
const LINE = { name: `Спецтехника ${RUN}`, unit: "смена", quantity: 2, rate: Number(MONEY.budgetRate), taxPercent: 0 };
let created: Awaited<ReturnType<typeof createItemsLine>> | null = null;

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
  created = await createItemsLine(db, { projectId: ctx.projectId, departmentId: ctx.departmentId, budgetId, run: RUN, line: LINE });
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
});

test.afterAll(async () => {
  await deleteItemsRun(db, ctx.projectId, RUN);
  if (budgetId) {
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

test("глава цеха без финансов: в Excel — смета по статьям с кодами и «О выгрузке», без листов-черновиков и формул", async ({
  browser,
}) => {
  const { context, page } = await openAs(browser, "nofin");
  await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
  const button = page.getByRole("button", { name: "Экспорт Excel" });
  await expect(button).toBeVisible({ timeout: 90_000 });
  const before = await lastSmetaExport();

  await button.click();
  const dialog = page.getByRole("dialog", { name: "Экспорт сметы в Excel" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Экспортировать Excel" }).click(),
  ]);
  // Имя — как на диске (шаг 4): «Смета · <Цех> · черновик (на утверждении) · ДД.ММ.ГГГГ.xlsx».
  expect(download.suggestedFilename()).toMatch(
    /^Смета · Транспортный цех · черновик \(на утверждении\) · \d{2}\.\d{2}\.\d{4}\.xlsx$/,
  );
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync((await download.path())!) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);

  expect(book.worksheets.map((s) => s.name)).toEqual(["Смета", "О выгрузке"]);
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
  const main = book.getWorksheet("Смета")!;
  expect(main.getCell("A1").value).toBe("Код");
  expect(main.getCell("L1").value).toBe("Итого");
  // Статья, подстатья, строка — с кодами; итог строки — 2 × ставка (расчёт сервера).
  expect(main.getCell("A2").value).toBe(created!.articleCode);
  expect(main.getCell("A4").value).toBe(created!.code);
  expect(main.getCell("B4").value).toBe(LINE.name);
  expect(main.getCell("L4").value).toBe(Number(MONEY.budgetRate) * 2);
  const info = book.getWorksheet("О выгрузке")!;
  expect(info.getCell("B1").value).toBe("Смета цеха «Транспортный цех»");
  expect(info.getCell("B3").value).toBe("на утверждении");
  expect(info.getCell("B5").value).toBe(E2E_ROLES.nofin.name);

  const audit = await lastSmetaExport();
  expect(audit?.id).not.toBe(before?.id);
  expect(audit?.summary).toBe("Выгрузка сметы цеха «Транспортный цех» в Excel: черновик (на утверждении)");
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
  await page.getByRole("dialog", { name: "Экспорт сметы в Excel" }).getByRole("button", { name: "Экспортировать Excel" }).click();
  await expect(page.getByText("Недостаточно прав")).toBeVisible();
  expect(downloaded).toBe(false);
  expect((await lastSmetaExport())?.id).toBe(before?.id);

  // Сама страница сметы чужого цеха для него — «не найдено».
  const res = await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
  expect(res?.status()).toBe(404);
  await context.close();
});
