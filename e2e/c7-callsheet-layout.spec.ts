import { expect, test, type Page } from "@playwright/test";
import { FILLED_DAY, LAYOUT_DAYS, NAMES } from "./fixtures/data";
import { findLeaks, workbookText } from "./helpers/leaks";
import { dayId, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Вид печатного листа вызывного (правило пустых блоков): день 4 заполнен целиком, день 5 —
 * пустой рабочий день. Обязательные блоки — всегда («не указано» серым), необязательные — только
 * заполненные. Excel — те же блоки в том же порядке; денег ни в листе, ни в книге нет.
 */

const ctx = e2eContext();
const filledDay = dayId(ctx, LAYOUT_DAYS.filled.dayNumber);
const emptyDay = dayId(ctx, LAYOUT_DAYS.empty.dayNumber);

test.use({ storageState: storageStatePath("producer") });

const REQUIRED_TITLES = ["Руководители группы", "Вызов цехов", "Актёры", "План съёмки · основной юнит"];
const OPTIONAL_TITLES = ["База и транспорт группы", "Групповка и дублёры", "Элементы площадки", "Второй юнит", "Схема объекта"];
const FIELD_LABELS = ["Сбор группы", "Место сбора", "Смена", "Репетиция", "Мотор", "Обед", "Стоп-мотор", "Погода", "Ограничения по актёрам"];

/** «Экспорт → Печать / PDF»: окно с листом. */
async function openPrint(page: Page, day: string) {
  await page.goto(projectPath(ctx, `/call-sheets/${day}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Печать / PDF" }).click();
  const popup = await popupPromise;
  await expect(popup.locator("main.sheet")).toBeVisible();
  await expect(popup.getByText("Готовим лист к печати")).toHaveCount(0);
  return popup;
}

async function blockTitles(popup: Page) {
  return popup.locator("h2").allInnerTexts();
}

test("печать пустого дня: обязательные блоки с «не указано», необязательных нет", async ({ page }) => {
  const popup = await openPrint(page, emptyDay);
  const sheet = popup.locator("main.sheet");
  for (const label of FIELD_LABELS) await expect(sheet.getByText(label, { exact: true })).toBeVisible();
  // Сбор и место — 2, пять времён, объект и ограничения — 2; погода — по прогнозу или «не указано».
  // Руководители, цеха, актёры, план — 4.
  expect(await sheet.locator(".nv").count()).toBeGreaterThanOrEqual(13);
  const titles = (await blockTitles(popup)).map((t) => t.toLocaleLowerCase("ru-RU"));
  expect(titles).toEqual(REQUIRED_TITLES.map((t) => t.toLocaleLowerCase("ru-RU")));
  for (const title of REQUIRED_TITLES) {
    const head = sheet.locator(".bh", { hasText: new RegExp(`^${title}`, "i") });
    await expect(head.locator("xpath=following-sibling::div[1]")).toHaveText("не указано");
  }
  await expect(sheet.getByText("Важно", { exact: true })).toHaveCount(0);
  for (const title of OPTIONAL_TITLES) await expect(sheet.getByText(title, { exact: true })).toHaveCount(0);
  // «Не указано» серым (в тёмной плашке сбора — свой серый).
  const color = await sheet.locator(".times .nv").first().evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(163, 163, 158)");
  await popup.close();
});

test("печать заполненного дня: все блоки макета по порядку, «не указано» нет, денег нет", async ({ page }) => {
  const popup = await openPrint(page, filledDay);
  const sheet = popup.locator("main.sheet");
  const titles = (await blockTitles(popup)).map((t) => t.toLocaleLowerCase("ru-RU"));
  expect(titles).toEqual(
    ["Руководители группы", "Вызов цехов", "База и транспорт группы", "Актёры", "Групповка и дублёры", "Элементы площадки", "План съёмки · основной юнит", "Второй юнит", "Схема объекта"].map(
      (t) => t.toLocaleLowerCase("ru-RU"),
    ),
  );
  await expect(sheet.locator(".nv")).toHaveCount(0);
  for (const text of [
    FILLED_DAY.crewMeetAddress,
    FILLED_DAY.important,
    FILLED_DAY.restrictions,
    FILLED_DAY.leader,
    FILLED_DAY.crew,
    FILLED_DAY.base,
    FILLED_DAY.group,
    FILLED_DAY.secondUnit,
    FILLED_DAY.schemePoint,
    "07:15",
    "13:30–14:30",
  ]) {
    await expect(sheet.getByText(text).first()).toBeVisible();
  }
  await expect(sheet.locator(".callbox .dark .t")).toHaveText("07:30");
  await expect(sheet.locator(".times > div")).toHaveCount(5);
  await expect(sheet.locator(".chip.car")).toHaveText("машина");
  await expect(sheet.getByText(`${FILLED_DAY.element}, 2 шт`).first()).toBeVisible();
  await popup.close();
  // Тот же лист без встроенного шрифта (base64 шрифта не мешает поиску сумм).
  const res = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${filledDay}/sheet`);
  expect(res.status()).toBe(200);
  expect(findLeaks("лист дня 4", await res.text())).toEqual([]);
});

/** Заголовки блоков книги — строки, набранные заглавными, по порядку листа. */
function xlsxTitles(text: string) {
  const known = [
    "ВЫЗЫВНОЙ ЛИСТ",
    "ВРЕМЕНА",
    "ПОГОДА",
    "ОБЪЕКТ",
    "ОБЪЕКТЫ",
    "ОГРАНИЧЕНИЯ ПО АКТЁРАМ",
    "ВАЖНО",
    "РУКОВОДИТЕЛИ ГРУППЫ",
    "ВЫЗОВ ЦЕХОВ",
    "БАЗА И ТРАНСПОРТ ГРУППЫ",
    "АКТЁРЫ",
    "ГРУППОВКА И ДУБЛЁРЫ",
    "ЭЛЕМЕНТЫ ПЛОЩАДКИ",
    "ПЛАН СЪЁМКИ · ОСНОВНОЙ ЮНИТ",
    "ВТОРОЙ ЮНИТ",
    "СХЕМА ОБЪЕКТА",
  ];
  // У объединённой ячейки значение повторяется во всех её клетках — повторы подряд убираем.
  return text
    .split("\n")
    .filter((line) => known.includes(line))
    .filter((line, i, all) => line !== all[i - 1]);
}

async function xlsxOf(page: Page, day: string) {
  const res = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day}/xlsx`);
  expect(res.status()).toBe(200);
  return workbookText(await res.body());
}

test("Excel пустого и заполненного дня: те же блоки и порядок, что в печати; денег нет", async ({ page }) => {
  const empty = await xlsxOf(page, emptyDay);
  expect(xlsxTitles(empty)).toEqual([
    "ВЫЗЫВНОЙ ЛИСТ",
    "ВРЕМЕНА",
    "ПОГОДА",
    "ОБЪЕКТ",
    "ОГРАНИЧЕНИЯ ПО АКТЁРАМ",
    "РУКОВОДИТЕЛИ ГРУППЫ",
    "ВЫЗОВ ЦЕХОВ",
    "АКТЁРЫ",
    "ПЛАН СЪЁМКИ · ОСНОВНОЙ ЮНИТ",
  ]);
  expect(empty.split("\n").filter((line) => line === "не указано").length).toBeGreaterThanOrEqual(13);

  const filled = await xlsxOf(page, filledDay);
  expect(xlsxTitles(filled)).toEqual([
    "ВЫЗЫВНОЙ ЛИСТ",
    "ВРЕМЕНА",
    "ПОГОДА",
    "ОБЪЕКТ",
    "ОГРАНИЧЕНИЯ ПО АКТЁРАМ",
    "ВАЖНО",
    "РУКОВОДИТЕЛИ ГРУППЫ",
    "ВЫЗОВ ЦЕХОВ",
    "БАЗА И ТРАНСПОРТ ГРУППЫ",
    "АКТЁРЫ",
    "ГРУППОВКА И ДУБЛЁРЫ",
    "ЭЛЕМЕНТЫ ПЛОЩАДКИ",
    "ПЛАН СЪЁМКИ · ОСНОВНОЙ ЮНИТ",
    "ВТОРОЙ ЮНИТ",
    "СХЕМА ОБЪЕКТА",
  ]);
  expect(filled).not.toContain("не указано");
  for (const text of [FILLED_DAY.leader, FILLED_DAY.crew, FILLED_DAY.base, FILLED_DAY.group, NAMES.actor.lastName, "Манипулятор E2E"]) {
    expect(filled).toContain(text);
  }
  // Ставка км спецтранспорта дня 4 — в базе есть, в листе её нет.
  expect(findLeaks("xlsx дня 4", filled)).toEqual([]);
  expect(findLeaks("xlsx дня 5", empty)).toEqual([]);
});
