import { expect, test, type Page } from "@playwright/test";
import { CREW } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { workbookText } from "./helpers/leaks";
import { downloadBuffer, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 9, шаг 4: предупреждение о пересечениях, фильтры в адресе, экспорт списка за период и
 * печать недели. Время — по поясу проекта (Москва, UTC+3).
 */

const ctx = e2eContext();
const db = e2eDb();
const CALENDAR = projectPath(ctx, "/preproduction/calendar");
const TMP = "Времянка пересечений";
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);
const msk = (key: string, time: string) => new Date(`${key}T${time}:00+03:00`);

let crewId: string;
let candidate: { id: string; lastName: string };
let readingTypeId: string;
let otherTypeId: string;
let ownerId: string;

async function cleanup() {
  await db.prepEvent.deleteMany({ where: { projectId: ctx.projectId, title: { startsWith: TMP } } });
  await db.auditionSchedule.deleteMany({ where: { projectId: ctx.projectId, comment: { startsWith: TMP } } });
}

test.beforeAll(async () => {
  await cleanup();
  crewId = (
    await db.crewMember.findFirstOrThrow({
      where: { projectId: ctx.projectId, lastName: CREW.manual.lastName },
      select: { id: true },
    })
  ).id;
  const cand = await db.castingCandidate.findFirstOrThrow({
    where: { projectId: ctx.projectId },
    select: { id: true, person: { select: { id: true, lastName: true } } },
  });
  candidate = { id: cand.person.id, lastName: cand.person.lastName };
  readingTypeId = (await db.prepEventType.findFirstOrThrow({ where: { projectId: ctx.projectId, name: "Читка" } })).id;
  otherTypeId = (await db.prepEventType.findFirstOrThrow({ where: { projectId: ctx.projectId, name: "Другое" } })).id;
  ownerId = (await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } })).ownerUserId;

  // Читка с человеком команды 15.12, 10:00–12:00 по Москве.
  await db.prepEvent.create({
    data: {
      projectId: ctx.projectId,
      title: `${TMP} читка`,
      typeId: readingTypeId,
      startAt: msk("2026-12-15", "10:00"),
      endAt: msk("2026-12-15", "12:00"),
      createdById: ownerId,
      participants: { create: [{ crewMemberId: crewId }] },
    },
  });
  // Другое событие весь день 16.12 с кандидатом: для проверки «+N» и экспорта.
  await db.prepEvent.create({
    data: {
      projectId: ctx.projectId,
      title: `${TMP} примерка`,
      typeId: otherTypeId,
      allDay: true,
      startDate: day("2026-12-16"),
      endDate: day("2026-12-16"),
      createdById: ownerId,
      participants: { create: [{ castingPersonId: candidate.id }] },
    },
  });
  // План проб кандидата 17.12 в 10:00.
  await db.auditionSchedule.create({
    data: {
      projectId: ctx.projectId,
      date: day("2026-12-17"),
      time: "10:00",
      comment: `${TMP} план`,
      candidates: {
        create: [
          {
            castingCandidateId: (
              await db.castingCandidate.findFirstOrThrow({
                where: { projectId: ctx.projectId, personId: candidate.id },
                select: { id: true },
              })
            ).id,
          },
        ],
      },
    },
  });
});

test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

async function setTime(page: Page, label: string, digits: string, shown: string) {
  const field = page.getByRole("dialog").getByLabel(label);
  await field.click();
  await field.pressSequentially(digits);
  await field.press("Tab");
  await expect(field).toHaveValue(shown);
}

async function addPerson(page: Page, lastName: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").click();
  await dialog.getByRole("combobox").fill(lastName);
  await page.getByRole("option", { name: new RegExp(lastName) }).first().click();
}

async function openNew(page: Page, dateKey: string) {
  await page.goto(`${CALENDAR}?view=week&date=${dateKey}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "+ Событие" }).click();
}

test.describe("пересечения", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: storageStatePath("producer") });

  test("человек занят в своём событии: предупреждение, «Вернуться» и «Сохранить всё равно»", async ({ page }) => {
    await openNew(page, "2026-12-15");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название *").fill(`${TMP} встреча`);
    await setTime(page, "Время начала", "1100", "11:00");
    await setTime(page, "Время окончания", "1300", "13:00");
    await addPerson(page, CREW.manual.lastName);
    await dialog.getByRole("button", { name: "Сохранить" }).click();

    const conflicts = dialog.getByTestId("event-conflicts");
    await expect(conflicts).toContainText(`${TMP} читка`);
    await expect(conflicts).toContainText(CREW.manual.lastName);
    if (process.env.E2E_STATE_SHOTS) {
      await page.screenshot({ path: `${process.env.E2E_STATE_SHOTS}/calendar-conflicts.png` });
    }
    expect(await db.prepEvent.count({ where: { projectId: ctx.projectId, title: `${TMP} встреча` } })).toBe(0);

    await dialog.getByRole("button", { name: "Вернуться" }).click();
    await expect(conflicts).toHaveCount(0);
    await expect(dialog.getByLabel("Название *")).toHaveValue(`${TMP} встреча`);

    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await dialog.getByRole("button", { name: "Сохранить всё равно" }).click();
    await expect(dialog).toBeHidden();
    expect(await db.prepEvent.count({ where: { projectId: ctx.projectId, title: `${TMP} встреча` } })).toBe(1);
  });

  test("встык и весь день против времени — без предупреждения", async ({ page }) => {
    await openNew(page, "2026-12-15");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название *").fill(`${TMP} встык`);
    await setTime(page, "Время начала", "0900", "09:00");
    await setTime(page, "Время окончания", "1000", "10:00");
    await addPerson(page, CREW.manual.lastName);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toBeHidden();

    await openNew(page, "2026-12-15");
    await dialog.getByLabel("Название *").fill(`${TMP} весь день`);
    await dialog.getByRole("checkbox", { name: "Весь день" }).check({ force: true });
    await addPerson(page, CREW.manual.lastName);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toBeHidden();
  });

  test("кандидат на пробе в это время — предупреждение с планом проб", async ({ page }) => {
    await openNew(page, "2026-12-17");
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Название *").fill(`${TMP} грим-тест`);
    await dialog.locator("#event-start-date").click();
    await page.getByRole("button", { name: "17", exact: true }).first().click();
    await setTime(page, "Время начала", "1030", "10:30");
    await setTime(page, "Время окончания", "1100", "11:00");
    await addPerson(page, candidate.lastName);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    const conflicts = dialog.getByTestId("event-conflicts");
    await expect(conflicts).toContainText("План проб");
    await expect(conflicts).toContainText("из кастинга");
  });
});

test.describe("фильтры", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("тип и человек в адресе, сброс", async ({ page }) => {
    await page.goto(`${CALENDAR}?view=list&date=2026-12-01`);
    // Первый из трёх выпадающих списков фильтров — «Тип».
    await page.locator("main button[aria-haspopup=\"listbox\"]").first().click();
    await page.getByRole("option", { name: "Читка", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`type=${readingTypeId}`));
    await expect(page.getByText(`${TMP} читка`)).toBeVisible();
    await expect(page.getByText(`${TMP} примерка`)).toHaveCount(0);
    // При фильтре по типу пробы скрыты: у них нет типа.
    await expect(page.getByRole("link", { name: /План проб/ })).toHaveCount(0);

    // Ссылка с фильтром открывается с ним же.
    await page.goto(`${CALENDAR}?view=list&date=2026-12-01&person=candidate:${candidate.id}`);
    await expect(page.getByText(`${TMP} примерка`)).toBeVisible();
    await expect(page.getByText(`${TMP} читка`)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /План проб/ }).first()).toBeVisible();

    await page.getByRole("button", { name: "Сбросить фильтры" }).click();
    await expect(page).not.toHaveURL(/person=/);
    await expect(page.getByText(`${TMP} читка`)).toBeVisible();
  });
});

test.describe("экспорт и печать", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("Excel за период: события и пробы, колонки по умолчанию", async ({ page }) => {
    await page.goto(`${CALENDAR}?view=month&date=2026-12-01`);
    await page.getByRole("button", { name: "Экспорт", exact: true }).click();
    await page.getByRole("menuitem", { name: "Excel" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Экспортировать Excel" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^Календарь · 2026-11-30 – 2027-01-03\.xlsx$/);
    const text = await workbookText(await downloadBuffer(file));
    for (const expected of ["Дата", "Участники", `${TMP} читка`, `${TMP} примерка`, "План проб (из кастинга)", candidate.lastName]) {
      expect(text).toContain(expected);
    }
  });

  test("печать недели одной кнопкой", async ({ page }) => {
    await page.goto(`${CALENDAR}?view=week&date=2026-12-15`);
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Печать недели" }).click();
    const popup = await popupPromise;
    await expect(popup.getByRole("heading", { name: "Неделя препродакшена" })).toBeVisible();
    await expect(popup.getByText(`${TMP} читка`)).toBeVisible();
    await expect(popup.getByText("Вторник, 15 декабря 2026 г.")).toBeVisible();
    await popup.close();
  });
});

test.describe("экспорт без права на кастинг", () => {
  test.use({ storageState: storageStatePath("nocast") });

  test("в файле нет проб и имени кандидата, есть «+1 кандидат»", async ({ page }) => {
    await page.goto(`${CALENDAR}?view=month&date=2026-12-01`);
    await page.getByRole("button", { name: "Экспорт", exact: true }).click();
    await page.getByRole("menuitem", { name: "Excel" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);
    await expect(dialog.getByText("Настройки колонок не сохранятся")).toBeVisible();
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Экспортировать Excel" }).click();
    const text = await workbookText(await downloadBuffer(await download));
    expect(text).toContain(`${TMP} примерка`);
    expect(text).toContain("+1 кандидат");
    expect(text).not.toContain(candidate.lastName);
    expect(text).not.toContain("План проб");
  });
});
