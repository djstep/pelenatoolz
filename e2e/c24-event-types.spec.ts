import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, fetchRsc, projectPath, storageStatePath } from "./helpers/session";

/** Волна 9, шаг 1: справочник типов событий в Настройках и права на него. */

const ctx = e2eContext();
const db = e2eDb();
const TYPES_PATH = projectPath(ctx, "/settings/event-types");
const TMP = "Времянка типа";
const DIR = process.env.E2E_STATE_SHOTS;

const typeRow = (page: Page, name: string) =>
  page.locator("main li").filter({ hasText: name });

async function cleanup() {
  await db.prepEventType.deleteMany({
    where: { projectId: ctx.projectId, name: { startsWith: TMP } },
  });
  await db.prepEventType.updateMany({
    where: { projectId: ctx.projectId, name: "Другое" },
    data: { isHidden: false },
  });
}

test.beforeAll(cleanup);
test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

test.describe("продюсер", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("начальный набор: 10 типов, пункт в меню «Настройки»", async ({ page }) => {
    await page.goto(TYPES_PATH);
    await expect(page.getByRole("heading", { name: "Типы событий", exact: true })).toBeVisible();
    for (const name of ["Встреча", "Читка", "Техпроход", "Производственное совещание", "Другое"]) {
      await expect(typeRow(page, name)).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Типы событий", exact: true })).toBeVisible();
    await expect
      .poll(() => db.prepEventType.count({ where: { projectId: ctx.projectId, name: { not: { startsWith: TMP } } } }))
      .toBe(10);
  });

  test("добавить, переименовать, сменить цвет, повтор имени, удалить; журнал", async ({ page }) => {
    await page.goto(TYPES_PATH);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "+ Добавить тип" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название *").fill(TMP);
    await dialog.getByRole("radio", { name: "Розовый" }).check();
    if (DIR) await page.screenshot({ path: `${DIR}/event-types-modal.png` });
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(typeRow(page, TMP)).toBeVisible();
    await expect(dialog).toBeHidden();
    const created = await db.prepEventType.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: TMP },
    });
    expect(created.color).toBe("pink");

    // Повтор имени: понятная ошибка, ввод не пропадает.
    await page.getByRole("button", { name: "+ Добавить тип" }).click();
    await dialog.getByLabel("Название *").fill(TMP);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText("Тип с таким названием уже есть").first()).toBeVisible();
    await expect(dialog.getByLabel("Название *")).toHaveValue(TMP);
    // Вопрос о несохранённом может не появиться: тест вводит быстрее, чем окно запоминает поля.
    await dialog.getByRole("button", { name: "Отмена" }).click();
    const discard = page.getByRole("button", { name: "Не сохранять" });
    if (await discard.isVisible()) await discard.click();
    await expect(dialog).toBeHidden();

    await typeRow(page, TMP).getByRole("button", { name: "Изменить" }).click();
    await dialog.getByLabel("Название *").fill(`${TMP} 2`);
    await dialog.getByRole("radio", { name: "Зелёный" }).check();
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(typeRow(page, `${TMP} 2`)).toBeVisible();
    await expect
      .poll(async () => (await db.prepEventType.findUnique({ where: { id: created.id } }))?.color)
      .toBe("green");

    await typeRow(page, `${TMP} 2`).getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await expect(typeRow(page, `${TMP} 2`)).toBeHidden();

    const log = await db.auditLog.findMany({
      where: { projectId: ctx.projectId, entityType: "prep_event_type", entityId: created.id },
      select: { action: true },
    });
    expect(log.map((row) => row.action).sort()).toEqual(["CREATE", "DELETE", "UPDATE"]);
  });

  test("тип с событием нельзя удалить, можно скрыть и вернуть", async ({ page }) => {
    const type = await db.prepEventType.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: "Другое" },
    });
    const event = await db.prepEvent.create({
      data: {
        projectId: ctx.projectId,
        title: `${TMP} событие`,
        typeId: type.id,
        allDay: true,
        startDate: new Date("2026-11-10T00:00:00Z"),
        endDate: new Date("2026-11-10T00:00:00Z"),
        createdById: (await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } })).ownerUserId,
      },
    });
    try {
      await page.goto(TYPES_PATH);
      const row = typeRow(page, "Другое");
      await expect(row.getByText("Событий: 1")).toBeVisible();
      await expect(row.getByRole("button", { name: "Удалить" })).toBeHidden();

      await row.getByRole("button", { name: "Скрыть" }).click();
      await expect(row.getByText("Скрыт", { exact: true })).toBeVisible();
      await row.getByRole("button", { name: "Показать" }).click();
      await expect(row.getByText("Скрыт", { exact: true })).toBeHidden();
    } finally {
      await db.prepEvent.delete({ where: { id: event.id } });
    }
  });
});

test.describe("без права правки календаря", () => {
  test.use({ storageState: storageStatePath("nofin") });

  test("страница закрыта, пункта в меню нет, данных в ответе нет", async ({ page }) => {
    await page.goto(TYPES_PATH);
    await expect(page.getByText("Нет доступа")).toBeVisible();
    await expect(page.getByRole("link", { name: "Типы событий", exact: true })).toHaveCount(0);
    const rsc = await fetchRsc(page, TYPES_PATH);
    expect(rsc.body).not.toContain("Производственное совещание");
  });
});

test.describe("снимки", () => {
  test.skip(!DIR, "только с E2E_STATE_SHOTS");
  test.use({ storageState: storageStatePath("producer") });

  test("обе темы, 1280 и 390 px", async ({ page }) => {
    await page.goto(TYPES_PATH);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${DIR}/event-types-${theme}-${width}.png` });
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
