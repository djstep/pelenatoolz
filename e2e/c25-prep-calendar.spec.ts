import { expect, test, type Page } from "@playwright/test";
import { CREW } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 9, шаг 2: экран календаря препродакшена. События со временем и на весь день, правка,
 * удаление, вид и дата из адреса, просмотр без права правки. Время — по поясу проекта (Москва).
 */

const ctx = e2eContext();
const db = e2eDb();
const CALENDAR = projectPath(ctx, "/preproduction/calendar");
const TMP = "Времянка календаря";
const DIR = process.env.E2E_STATE_SHOTS;
const MANUAL = `${CREW.manual.lastName} ${CREW.manual.firstName}`;

const at = (query: string) => `${CALENDAR}?${query}`;

async function cleanup() {
  await db.prepEvent.deleteMany({ where: { projectId: ctx.projectId, title: { startsWith: TMP } } });
}

test.beforeAll(cleanup);
test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

/** Своё событие для проверок просмотра: не зависит от того, прошли ли тесты продюсера. */
const SHOWN = `${TMP} показ`;
async function seedShownEvent() {
  if (await db.prepEvent.count({ where: { projectId: ctx.projectId, title: SHOWN } })) return;
  const type = await db.prepEventType.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: "Выбор объекта" },
  });
  const project = await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
  await db.prepEvent.create({
    data: {
      projectId: ctx.projectId,
      title: SHOWN,
      typeId: type.id,
      allDay: true,
      startDate: new Date("2026-12-04T00:00:00Z"),
      endDate: new Date("2026-12-04T00:00:00Z"),
      createdById: project.ownerUserId,
    },
  });
}

/** Поле времени принимает цифры, значение фиксирует уход из поля: ждём, пока оно встанет. */
async function setTime(page: Page, label: string, digits: string, shown: string) {
  const field = page.getByRole("dialog").getByLabel(label);
  // Как человек: щелчок выделяет время, цифры набираются по одной.
  await field.click();
  await field.pressSequentially(digits);
  await field.press("Tab");
  await expect(field).toHaveValue(shown);
}

async function save(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("продюсер", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: storageStatePath("producer") });

  test("пункт в меню, вид и дата из адреса", async ({ page }) => {
    await page.goto(at("view=week&date=2026-12-02"));
    await expect(page.getByTestId("calendar-period")).toHaveText("30 нояб. – 6 дек. 2026 г.");
    await expect(page.getByRole("link", { name: "Неделя", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("link", { name: "Календарь препродакшена" })).toBeVisible();

    await page.getByRole("link", { name: "Вперёд" }).click();
    await expect(page).toHaveURL(/view=week&date=2026-12-09/);
    await page.getByRole("link", { name: "Месяц", exact: true }).click();
    await expect(page).toHaveURL(/view=month&date=2026-12-09/);
    await expect(page.getByTestId("calendar-period")).toHaveText("Декабрь 2026");
  });

  test("событие со временем: человек из команды, цех, время по поясу проекта", async ({ page }) => {
    await page.goto(at("view=month&date=2026-12-01"));
    // Сайт разработки дособирает страницу после открытия: ввод в это время может пропасть.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "+ Событие" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name: "Весь день" })).not.toBeChecked();
    await dialog.getByLabel("Название *").fill(`${TMP} встреча`);
    await setTime(page, "Время начала", "1430", "14:30");
    await setTime(page, "Время окончания", "1600", "16:00");
    await dialog.getByLabel("Место текстом").click();
    await dialog.getByLabel("Место текстом").pressSequentially("Офис, переговорная");
    await expect(dialog.getByLabel("Место текстом")).toHaveValue("Офис, переговорная");
    await dialog.getByRole("combobox").click();
    await dialog.getByRole("combobox").fill(CREW.manual.lastName);
    await page.getByRole("option", { name: new RegExp(CREW.manual.lastName) }).click();
    await expect(dialog.getByText(MANUAL)).toBeVisible();
    if (DIR) await page.screenshot({ path: `${DIR}/calendar-event-modal.png` });
    await save(page);

    const event = await db.prepEvent.findFirstOrThrow({
      where: { projectId: ctx.projectId, title: `${TMP} встреча` },
      include: { participants: true, type: true },
    });
    expect(event.allDay).toBe(false);
    expect(event.startAt?.toISOString()).toBe("2026-12-01T11:30:00.000Z");
    expect(event.endAt?.toISOString()).toBe("2026-12-01T13:00:00.000Z");
    expect(event.startDate).toBeNull();
    expect(event.participants).toHaveLength(1);
    expect(event.type.name).toBe("Встреча");

    const cell = page.locator('[data-day="2026-12-01"]');
    const chip = cell.getByRole("button", { name: new RegExp(`${TMP} встреча`) });
    await expect(chip).toContainText(`14:30 ${TMP} встреча`);
    // Тип назван словом, а не только цветом.
    await expect(chip).toContainText("Встреча");
  });

  test("весь день: клик по пустому дню, несколько дней", async ({ page }) => {
    await page.goto(at("view=month&date=2026-12-01"));
    await page.locator('[data-day="2026-12-03"]').click({ position: { x: 60, y: 80 } });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("checkbox", { name: "Весь день" })).toBeChecked();
    await dialog.getByLabel("Название *").fill(`${TMP} выбор объекта`);
    await dialog.locator('button[aria-haspopup="listbox"]').first().click();
    await page.getByRole("option", { name: "Выбор объекта" }).click();
    await dialog.locator("#event-end-date").click();
    // В панели видны и дни соседних месяцев: первое «5» — 5 декабря.
    await page.getByRole("button", { name: "5", exact: true }).first().click();
    await save(page);

    const event = await db.prepEvent.findFirstOrThrow({
      where: { projectId: ctx.projectId, title: `${TMP} выбор объекта` },
    });
    expect(event.allDay).toBe(true);
    expect(event.startDate?.toISOString()).toBe("2026-12-03T00:00:00.000Z");
    expect(event.endDate?.toISOString()).toBe("2026-12-05T00:00:00.000Z");
    expect(event.startAt).toBeNull();
    for (const day of ["2026-12-03", "2026-12-04", "2026-12-05"]) {
      await expect(page.locator(`[data-day="${day}"]`)).toContainText(`${TMP} выбор объекта`);
    }
  });

  test("неделя и список показывают оба события", async ({ page }) => {
    await page.goto(at("view=week&date=2026-12-01"));
    await expect(page.locator('[data-hours="2026-12-01"]')).toContainText(`${TMP} встреча`);
    await expect(page.locator('[data-allday="2026-12-04"]')).toContainText(`${TMP} выбор объекта`);
    if (DIR) await page.screenshot({ path: `${DIR}/calendar-week.png` });

    await page.goto(at("view=list&date=2026-12-01"));
    await expect(page.getByText("14:30–16:00")).toBeVisible();
    // В скрытом списке фильтра «Человек» то же имя: ищем только в списке событий.
    await expect(page.locator("section").getByText(MANUAL)).toBeVisible();
    // Многодневное событие стоит в каждом своём дне.
    await expect(page.getByText("3 дек. 2026 г. – 5 дек. 2026 г.")).toHaveCount(3);
  });

  test("правка и окончание раньше начала", async ({ page }) => {
    await page.goto(at("view=list&date=2026-12-01"));
    await page.getByRole("button", { name: new RegExp(`${TMP} встреча`) }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название *").fill(`${TMP} встреча 2`);
    await setTime(page, "Время окончания", "1300", "13:00");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Окончание раньше начала");

    await setTime(page, "Время окончания", "1700", "17:00");
    await save(page);
    const event = await db.prepEvent.findFirstOrThrow({
      where: { projectId: ctx.projectId, title: `${TMP} встреча 2` },
    });
    expect(event.endAt?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  test("удаление с подтверждением, записи в журнале", async ({ page }) => {
    const event = await db.prepEvent.findFirstOrThrow({
      where: { projectId: ctx.projectId, title: `${TMP} встреча 2` },
    });
    await page.goto(at("view=list&date=2026-12-01"));
    await page.getByRole("button", { name: new RegExp(`${TMP} встреча 2`) }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Удалить" }).click();
    await page.getByRole("dialog", { name: /Удалить событие/ }).getByRole("button", { name: "Удалить" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`${TMP} встреча 2`) })).toHaveCount(0);
    expect(await db.prepEvent.count({ where: { id: event.id } })).toBe(0);

    const log = await db.auditLog.findMany({
      where: { projectId: ctx.projectId, entityType: "prep_event", entityId: event.id },
      select: { action: true, changes: true },
    });
    expect(log.map((row) => row.action).sort()).toEqual(["CREATE", "DELETE", "UPDATE"]);
    expect(JSON.stringify(log)).not.toContain(CREW.manual.lastName);
  });
});

test.describe("только просмотр", () => {
  test.use({ storageState: storageStatePath("nofin") });
  test.beforeAll(seedShownEvent);

  test("видит событие, правки нет", async ({ page }) => {
    await page.goto(at("view=month&date=2026-12-01"));
    await expect(page.locator('[data-day="2026-12-04"]')).toContainText(SHOWN);
    await expect(page.getByRole("button", { name: "+ Событие" })).toHaveCount(0);
    await page.locator('[data-day="2026-12-04"]').getByRole("button", { name: new RegExp(SHOWN) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Выбор объекта", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Сохранить" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Удалить" })).toHaveCount(0);
  });
});

test.describe("телефон", () => {
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 390, height: 844 } });
  test.beforeAll(seedShownEvent);

  test("без вида в адресе открывается список, страница не шире экрана", async ({ page }) => {
    await page.goto(at("date=2026-12-01"));
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByText(SHOWN).first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("снимки", () => {
  test.skip(!DIR, "только с E2E_STATE_SHOTS");
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(seedShownEvent);

  test("месяц, неделя, список: обе темы, 1280 и 390 px", async ({ page }) => {
    for (const view of ["month", "week", "list"]) {
      await page.goto(at(`view=${view}&date=2026-12-01`));
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"]) {
          await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
          await page.waitForTimeout(500);
          await page.screenshot({ path: `${DIR}/calendar-${view}-${theme}-${width}.png` });
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  });
});
