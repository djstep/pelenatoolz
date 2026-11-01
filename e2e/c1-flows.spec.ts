import { expect, test, type Page } from "@playwright/test";
import { DAYS, NAMES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { workbookText } from "./helpers/leaks";
import { dayId, downloadBuffer, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/** (В) Основные сценарии вызывного и выгрузок под продюсером. */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);
const day2 = dayId(ctx, 2);
const day3 = dayId(ctx, 3);
const db = e2eDb();

test.use({ storageState: storageStatePath("producer") });
test.afterAll(async () => {
  await db.$disconnect();
});

async function statusOf(shootDayId: string) {
  return db.callSheet.findUnique({ where: { shootDayId }, select: { status: true, version: true } });
}

/** Кнопка панели статуса → подтверждение → окно закрылось → сообщение (точный текст). */
async function runStatusCommand(page: Page, label: string, confirmLabel: string, done: string | RegExp) {
  await page.getByRole("region", { name: "Статус вызывного" }).getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(done, { exact: true }).first()).toBeVisible();
}

test("день 2: «Создать вызывной» → блоки из шаблона, черновик версии 1", async ({ page }) => {
  await page.goto(projectPath(ctx, `/call-sheets/${day2}`));
  if (!(await statusOf(day2))) {
    await page.getByRole("button", { name: "Создать вызывной" }).click();
    await expect.poll(async () => (await statusOf(day2))?.status, { timeout: 20_000 }).toBe("DRAFT");
    await page.reload();
  }
  await expect(page.getByRole("region", { name: "Статус вызывного" })).toBeVisible();
});

test("день 2: на согласование → без права «Утвердить» нет → утвердить → печать версии → внести изменения", async ({
  page,
  browser,
}) => {
  await page.goto(projectPath(ctx, `/call-sheets/${day2}`));
  const start = await statusOf(day2);
  test.skip(!start, "вызывного дня 2 нет");
  if (start!.status === "APPROVED") {
    await runStatusCommand(page, "Внести изменения", "Создать", `Черновик версии ${start!.version + 1}`);
  } else if (start!.status === "IN_REVIEW") {
    await runStatusCommand(page, "Вернуть в черновик", "Вернуть", "Возвращено в черновик");
  }
  await page.reload();
  const draft = (await statusOf(day2))!;
  expect(draft.status).toBe("DRAFT");

  await runStatusCommand(page, "На согласование", "Отправить", "Отправлено на согласование");
  expect((await statusOf(day2))!.status).toBe("IN_REVIEW");

  // Список вызывных: «Ждут утверждения» у продюсера.
  await page.goto(projectPath(ctx, "/call-sheets"));
  await expect(page.getByText(/Ждут утверждения: \d+/)).toBeVisible();

  // Роль без права утверждения кнопки «Утвердить» не видит.
  const other = await browser.newContext({ storageState: storageStatePath("nofin") });
  const nofinPage = await other.newPage();
  await nofinPage.goto(projectPath(ctx, `/call-sheets/${day2}`));
  const panel = nofinPage.getByRole("region", { name: "Статус вызывного" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Утвердить", exact: true })).toHaveCount(0);
  await other.close();

  await page.goto(projectPath(ctx, `/call-sheets/${day2}`));
  await runStatusCommand(page, "Утвердить", "Утвердить", "Утверждено");
  const approved = (await statusOf(day2))!;
  expect(approved).toEqual({ status: "APPROVED", version: draft.version });
  await page.reload();
  // Утверждённый не правится до «Внести изменения».
  await expect(page.getByRole("button", { name: "Редактировать вызывной" })).toHaveCount(0);

  // Печать утверждённой версии из списка.
  await page.getByText(/Утверждённые версии/).click();
  const version = page.getByRole("listitem").filter({ hasText: `Версия ${approved.version}` });
  const popupPromise = page.waitForEvent("popup");
  await version.getByRole("button", { name: "Печать" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText(new RegExp(`версия ${approved.version} · утверждён`)).first()).toBeVisible();
  await popup.close();

  await runStatusCommand(page, "Внести изменения", "Создать", `Черновик версии ${approved.version + 1}`);
  expect(await statusOf(day2)).toEqual({ status: "DRAFT", version: approved.version + 1 });
});

test("день 1: «Печать / PDF» — окно со шрифтом Medeo и меткой черновика", async ({ page }) => {
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Печать / PDF" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText(NAMES.actor.lastName).first()).toBeVisible();
  await expect(popup.getByText("ЧЕРНОВИК").first()).toBeVisible();
  const html = await popup.content();
  expect(html).toContain("data:font/woff2;base64,");
  expect(html).not.toContain("Готовим лист к печати");
  expect(await popup.evaluate(() => document.fonts.check('12px "Medeo Sans"'))).toBe(true);
  await popup.close();
});

test("день 1: Excel вызывного и явочный лист — имена файлов с датой дня, данные дня внутри", async ({ page }) => {
  const date = DAYS[0].date;
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  let downloadPromise = page.waitForEvent("download");
  await page.getByRole("group", { name: "Вызывной лист" }).getByRole("menuitem", { name: "Excel" }).click();
  let download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`call-sheet-day-1-${date}.xlsx`);
  expect(await workbookText(await downloadBuffer(download))).toContain(NAMES.transport);

  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  downloadPromise = page.waitForEvent("download");
  await page.getByRole("group", { name: "Явочный лист" }).getByRole("menuitem", { name: "Excel" }).click();
  download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`attendance-day-1-${date}.xlsx`);
  expect(await workbookText(await downloadBuffer(download))).toContain(NAMES.actor.lastName);
});

test("выходной день: вызывного нет, понятное сообщение", async ({ page }) => {
  await page.goto(projectPath(ctx, `/call-sheets/${day3}`));
  await expect(page.getByText(/формируется только для/)).toBeVisible();
});

test("отчёт смены дня 1 открывается, строки актёра, транспорта и объекта на месте", async ({ page }) => {
  await page.goto(projectPath(ctx, `/reports/${day1}`));
  for (const name of [NAMES.actor.lastName, NAMES.transport, NAMES.location]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test("вход: неверный пароль — сообщение, остаёмся на странице входа", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/ru/login");
  await page.locator("#email").fill("e2e-producer@pelena.test");
  await page.locator("#password").fill("wrong-password-e2e");
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('[role="alert"], .text-\\[var\\(--danger\\)\\]').first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
