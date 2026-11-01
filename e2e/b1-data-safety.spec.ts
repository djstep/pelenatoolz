import { expect, test, type Page } from "@playwright/test";
import { MONEY, NAMES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * (Б) Сохранность данных: открытие страниц ничего не пишет; сохранение спецтранспорта без
 * «Финансы: правка» не трогает ставку за км и статью; вторая вкладка не затирает первую.
 */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);
const day2 = dayId(ctx, 2);
const db = e2eDb();

test.afterAll(async () => {
  await db.$disconnect();
});

/** Всё, что могла бы задеть запись при открытии страниц. */
async function snapshot() {
  const [audit, sheets, days, report, usages, slots] = await Promise.all([
    db.auditLog.count({ where: { projectId: ctx.projectId } }),
    db.callSheet.findMany({
      where: { projectId: ctx.projectId },
      select: { id: true, revision: true, updatedAt: true, status: true },
      orderBy: { id: "asc" },
    }),
    db.shootDay.findMany({ where: { projectId: ctx.projectId }, select: { id: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.productionReport.findMany({
      where: { shootDay: { projectId: ctx.projectId } },
      select: { id: true, updatedAt: true, workRows: { select: { id: true, updatedAt: true }, orderBy: { id: "asc" } } },
    }),
    db.shootDayResourceUsage.count({ where: { shootDay: { projectId: ctx.projectId } } }),
    db.shootDayTimeSlot.count({ where: { shootDay: { projectId: ctx.projectId } } }),
  ]);
  return JSON.stringify({ audit, sheets, days, report, usages, slots });
}

async function openTransportEditor(page: Page) {
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await page.getByRole("button", { name: "Редактировать вызывной" }).click();
  const note = page.getByLabel("Примечание, строка 1");
  await expect(note).toBeVisible();
  return note;
}

async function transportRow() {
  return db.shootDayTransport.findFirstOrThrow({
    where: { shootDayId: day1, name: NAMES.transport },
    select: { kmRate: true, budgetItemId: true, notes: true },
  });
}

for (const role of ["producer", "nofin"] as E2ERoleKey[]) {
  test(`${role}: открытие вызывных, отчёта смены, КПП, либретто ничего не пишет`, async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStatePath(role) });
    const page = await context.newPage();
    const before = await snapshot();
    for (const path of [
      `/call-sheets/${day1}`,
      `/call-sheets/${day2}`,
      "/call-sheets",
      `/reports/${day1}`,
      "/reports",
      "/schedule",
      "/libretto",
      "/preproduction/casting",
    ]) {
      await page.goto(projectPath(ctx, path));
      await page.waitForLoadState("networkidle");
    }
    expect(await snapshot()).toBe(before);
    await context.close();
  });
}

test.describe("спецтранспорт без «Финансы: правка»", () => {
  test.use({ storageState: storageStatePath("nofin") });

  test("поля ставки нет; сохранение меняет примечание, ставка за км и статья — прежние", async ({ page }) => {
    const before = await transportRow();
    expect(before.kmRate?.toString()).toBe(MONEY.transportKmRate);
    const note = await openTransportEditor(page);
    await expect(page.getByLabel("Ставка за км, строка 1")).toHaveCount(0);
    const text = `E2E без финансов ${Date.now()}`;
    await note.fill(text);
    await page.getByRole("button", { name: "Сохранить спецтранспорт" }).click();
    await expect.poll(async () => (await transportRow()).notes, { timeout: 20_000 }).toBe(text);
    const after = await transportRow();
    expect(after.kmRate?.toString()).toBe(MONEY.transportKmRate);
    expect(after.budgetItemId).toBe(before.budgetItemId);
  });
});

test.describe("две вкладки одного вызывного", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("сохранение во второй — «изменили в другом окне», первая правка цела", async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    const noteA = await openTransportEditor(first);
    const noteB = await openTransportEditor(second);
    const textA = `E2E вкладка 1 ${Date.now()}`;
    await noteA.fill(textA);
    await first.getByRole("button", { name: "Сохранить спецтранспорт" }).click();
    await expect.poll(async () => (await transportRow()).notes, { timeout: 20_000 }).toBe(textA);

    await noteB.fill(`E2E вкладка 2 ${Date.now()}`);
    await second.getByRole("button", { name: "Сохранить спецтранспорт" }).click();
    await expect(second.getByText("Вызывной изменили в другом окне").first()).toBeVisible();
    expect((await transportRow()).notes).toBe(textA);
    // Ставка у продюсера не сбивается сохранением.
    expect((await transportRow()).kmRate?.toString()).toBe(MONEY.transportKmRate);
  });
});

test.describe("удаление сцены из дня КПП", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("причина в окне, «Удалить» неактивна, сцена на месте", async ({ page }) => {
    const before = await db.scene.count({ where: { projectId: ctx.projectId } });
    await page.goto(projectPath(ctx, "/libretto"));
    await page.locator("tbody tr").first().locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: "Групповые действия" }).click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/стоит в днях КПП/)).toBeVisible();
    // Удалить нельзя — кнопка неактивна, причина в окне (сервер тоже отказывает — модульные тесты).
    await expect(dialog.getByRole("button", { name: "Удалить", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    expect(await db.scene.count({ where: { projectId: ctx.projectId } })).toBe(before);
  });
});
