import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Потеря работы пользователя (ветка fix/data-loss). Обрыв связи — отказ запросов к серверным
 * действиям: окно экспорта не зависает, страница не падает, после возврата связи всё работает.
 * Формы — показательные случаи ошибки сервера и ухода со страницы, не все формы.
 */

const ctx = e2eContext();
const db = e2eDb();
const CREW_PATH = projectPath(ctx, "/crew");
const SCHEDULE_PATH = projectPath(ctx, "/schedule");
const NO_CONNECTION = "Нет связи, данные не сохранены — попробуйте ещё раз";
const NO_LINK = "нет связи с сервером";
const BASELINE_MS = 300;

/** Все запросы к серверным действиям обрываются, пока не вызван возврат связи. */
async function cutActions(page: Page) {
  const handler = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    if (route.request().headers()["next-action"]) await route.abort("connectionfailed");
    else await route.fallback();
  };
  await page.route("**/*", handler);
  return () => page.unroute("**/*", handler);
}

async function openPage(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
}

test.describe("обрыв связи в окнах экспорта", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("Команда: раскладка не загрузилась — окно работает с колонками по умолчанию", async ({ page }) => {
    await openPage(page, CREW_PATH);
    const restore = await cutActions(page);
    await page.getByRole("menuitem", { name: "Excel", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(page.getByText(NO_LINK).first()).toBeVisible();
    await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);
    const run = dialog.getByRole("button", { name: "Экспортировать Excel" });
    await expect(run).toBeEnabled();

    await restore();
    const download = page.waitForEvent("download");
    await run.click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("Команда: обрыв при выгрузке — страница цела, повтор срабатывает", async ({ page }) => {
    await openPage(page, CREW_PATH);
    const layout = page.waitForResponse((res) => Boolean(res.request().headers()["next-action"]));
    await page.getByRole("menuitem", { name: "Excel", exact: true }).click();
    await layout;
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);

    const restore = await cutActions(page);
    const run = dialog.getByRole("button", { name: "Экспортировать Excel" });
    await run.click();
    await expect(page.getByText(NO_LINK).first()).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(run).toBeEnabled();

    await restore();
    const download = page.waitForEvent("download");
    await run.click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test("КПП: данные не загрузились — окно не зависает, выгрузка недоступна", async ({ page }) => {
    await openPage(page, SCHEDULE_PATH);
    const restore = await cutActions(page);
    await page.getByText("Краткий КПП", { exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(page.getByText(NO_LINK).first()).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeEnabled();
    await expect(dialog.getByRole("button", { name: /Экспортировать/ })).toBeDisabled();
    await restore();
  });
});

test.describe("обрыв связи при сохранении формы", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("карточка сцены: ввод на месте, тост, повторное сохранение проходит", async ({ page }) => {
    const scene = await db.scene.findFirstOrThrow({
      where: { projectId: ctx.projectId, number: "2" },
    });
    const typed = "Текст, написанный без связи";
    try {
      await page.goto(projectPath(ctx, `/libretto/${scene.id}`));
      await page.waitForLoadState("networkidle");
      await page.locator("#summary").fill(typed);
      await page.locator("#description").fill(`${typed} — примечание`);

      const restore = await cutActions(page);
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();

      await expect(page.getByText(NO_CONNECTION).first()).toBeVisible();
      await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
      await expect(page.locator("#summary")).toHaveValue(typed);
      await expect(page.locator("#description")).toHaveValue(`${typed} — примечание`);
      const untouched = await db.scene.findUniqueOrThrow({ where: { id: scene.id } });
      expect(untouched.summary).toBe(scene.summary);

      await restore();
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect
        .poll(async () => (await db.scene.findUniqueOrThrow({ where: { id: scene.id } })).summary)
        .toBe(typed);
    } finally {
      await db.scene.update({
        where: { id: scene.id },
        data: { summary: scene.summary, description: scene.description },
      });
    }
  });
});

test.describe("ввод не теряется при ошибке сервера", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("карточка сцены: «номер уже существует» — всё введённое на месте, база не менялась", async ({ page }) => {
    const [first, second] = await db.scene.findMany({
      where: { projectId: ctx.projectId, number: { in: ["1", "2"] } },
      orderBy: { number: "asc" },
    });
    await page.goto(projectPath(ctx, `/libretto/${second!.id}`));
    await page.waitForLoadState("networkidle");

    const typed = "Текст, который нельзя потерять";
    await page.locator("#number").fill(first!.number);
    await page.locator("#summary").fill(typed);
    await page.locator("#description").fill(`${typed} — примечание`);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();

    await expect(page.getByText("Сцена с таким номером уже существует")).toBeVisible();
    await expect(page.locator("#number")).toHaveValue(first!.number);
    await expect(page.locator("#summary")).toHaveValue(typed);
    await expect(page.locator("#description")).toHaveValue(`${typed} — примечание`);

    const saved = await db.scene.findUniqueOrThrow({ where: { id: second!.id } });
    expect(saved.number).toBe(second!.number);
    expect(saved.summary).toBe(second!.summary);
  });

  test("кандидат кастинга: ошибка сохраняет ввод, в вопросе при уходе есть «Сохранить»", async ({ page }) => {
    await page.goto(projectPath(ctx, `/preproduction/casting/${ctx.castingPersonId}`));
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    // Форма запоминает исходные значения не сразу: человек быстрее этого не печатает.
    await page.waitForTimeout(BASELINE_MS);

    const notes = "Заметка, которая должна остаться";
    await page.locator("#notes").fill(notes);
    // Пробелы проходят проверку браузера, но не сервера.
    await page.locator("#lastName").fill("   ");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Проверьте данные кандидата").first()).toBeVisible();
    await expect(page.locator("#notes")).toHaveValue(notes);

    await page.getByRole("link", { name: "Обзор", exact: true }).click();
    const question = page.getByRole("alertdialog");
    await expect(question.getByRole("button", { name: "Сохранить" })).toBeVisible();
    await question.getByRole("button", { name: "Остаться" }).click();
    await expect(page.locator("#notes")).toHaveValue(notes);

    const person = await db.castingPerson.findUniqueOrThrow({ where: { id: ctx.castingPersonId } });
    expect(person.notes).not.toBe(notes);
  });

  test("кандидат кастинга: дата рождения видна в поле и не стирается при сохранении", async ({ page }) => {
    const before = await db.castingPerson.findUniqueOrThrow({ where: { id: ctx.castingPersonId } });
    await db.castingPerson.update({
      where: { id: ctx.castingPersonId },
      data: { birthDate: new Date("1990-03-03T00:00:00.000Z") },
    });
    try {
      await page.goto(projectPath(ctx, `/preproduction/casting/${ctx.castingPersonId}`));
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Редактировать", exact: true }).click();
      await expect(page.locator('input[name="birthDate"]')).toHaveValue("1990-03-03");
      await page.getByRole("button", { name: "Сохранить", exact: true }).click();
      await expect(page.getByText("Кандидат сохранён").first()).toBeVisible();
      const saved = await db.castingPerson.findUniqueOrThrow({ where: { id: ctx.castingPersonId } });
      expect(saved.birthDate?.toISOString().slice(0, 10)).toBe("1990-03-03");
    } finally {
      await db.castingPerson.update({
        where: { id: ctx.castingPersonId },
        data: { birthDate: before.birthDate },
      });
    }
  });

  test("новый проект: ошибка сохраняет ввод, уход спрашивает", async ({ page }) => {
    const before = await db.project.count();
    await page.goto("/ru/projects/new");
    await page.waitForLoadState("networkidle");

    const fullName = "Полное название, которое нельзя потерять";
    await page.locator("#fullName").fill(fullName);
    await page.locator("#description").fill("Описание проекта");
    // Пробелы проходят проверку браузера, но не сервера.
    await page.locator("#name").fill("   ");
    await page.getByRole("button", { name: "Создать", exact: false }).click();

    await expect(page.getByText("Проверьте данные проекта")).toBeVisible();
    await expect(page.locator("#fullName")).toHaveValue(fullName);
    await expect(page.locator("#description")).toHaveValue("Описание проекта");

    await page.locator('a[href$="/projects"]').first().click();
    const question = page.getByRole("alertdialog");
    await expect(question.getByRole("button", { name: "Не сохранять" })).toBeVisible();
    await expect(question.getByRole("button", { name: "Сохранить" })).toHaveCount(0);
    await question.getByRole("button", { name: "Остаться" }).click();
    await expect(page.locator("#fullName")).toHaveValue(fullName);
    expect(await db.project.count()).toBe(before);
  });
});

test.describe("после успешного сохранения", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("настройки проекта: стёр, сохранил, перезагрузил — пусто", async ({ page }) => {
    const before = await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    await db.project.update({ where: { id: ctx.projectId }, data: { description: "Описание из базы" } });
    try {
      await page.goto(projectPath(ctx, "/settings"));
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(BASELINE_MS);
      await page.locator("#description").fill("");
      await page.getByRole("button", { name: "Сохранить изменения" }).click();
      await expect(page.getByText("Проект сохранён").first()).toBeVisible();

      const saved = await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      expect(saved.description).toBeNull();
      await expect(page.locator("#description")).toHaveValue("");

      await page.reload();
      await expect(page.locator("#name")).toBeVisible();
      await expect(page.locator("#description")).toHaveValue("");
    } finally {
      await db.project.update({ where: { id: ctx.projectId }, data: { description: before.description } });
    }
  });

  test("новый проект: создание уводит на проект без вопроса", async ({ page }) => {
    const name = "E2E проект без вопроса";
    await db.project.deleteMany({ where: { name } });
    try {
      await page.goto("/ru/projects/new");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(BASELINE_MS);
      await page.locator("#name").fill(name);
      await page.getByRole("button", { name: "Создать", exact: false }).click();
      await expect(page).toHaveURL(/\/ru\/projects\/c[a-z0-9]+/);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    } finally {
      await db.project.deleteMany({ where: { name } });
    }
  });
});

test.describe("новый съёмочный день", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("уход спрашивает, после добавления номер обновляется", async ({ page }) => {
    await page.goto(SCHEDULE_PATH);
    await page.waitForLoadState("networkidle");
    const dayNumber = page.locator("#dayNumber");
    const number = Number(await dayNumber.inputValue());

    await page.locator("#dateFrom").click();
    const calendar = page.getByRole("dialog");
    for (let month = 0; month < 7; month += 1) {
      await calendar.getByRole("button", { name: "Следующий месяц" }).click();
    }
    await calendar.locator("button", { hasText: /^15$/ }).click();
    await page.getByRole("link", { name: "Обзор", exact: true }).click();
    const question = page.getByRole("alertdialog");
    await expect(question.getByRole("button", { name: "Не сохранять" })).toBeVisible();
    await question.getByRole("button", { name: "Остаться" }).click();

    try {
      await page.getByRole("button", { name: "Добавить день" }).click();
      await expect(dayNumber).toHaveValue(String(number + 1));
    } finally {
      await db.shootDay.deleteMany({ where: { projectId: ctx.projectId, dayNumber: number } });
    }
  });
});

test.describe("«Сохранить» в вопросе при уходе", () => {
  test.use({ storageState: storageStatePath("producer") });

  const EMAIL = "e2e-double-invite@pelena.test";
  const invites = () => db.projectInvite.count({ where: { projectId: ctx.projectId, email: EMAIL } });
  const cleanup = () => db.projectInvite.deleteMany({ where: { projectId: ctx.projectId, email: EMAIL } });
  test.beforeEach(cleanup);
  test.afterAll(cleanup);

  test("форма уже отправлена: второй раз не отправляется, приглашение одно", async ({ page }) => {
    await page.goto(projectPath(ctx, "/members"));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(BASELINE_MS);
    await page.locator("#email").fill(EMAIL);

    let sent = 0;
    await page.route("**/*", async (route) => {
      if (route.request().headers()["next-action"]) {
        sent += 1;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      await route.fallback();
    });
    await page.locator("main").getByRole("button", { name: "Создать ссылку" }).click();
    await page
      .getByRole("navigation", { name: "Вкладки раздела" })
      .getByRole("link", { name: /^Роли и права/ })
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Сохранить" }).click();

    await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, "/roles")}$`));
    expect(sent).toBe(1);
    expect(await invites()).toBe(1);
  });

  test("обрыв: вопрос закрывается сразу, форма с вводом на месте, экрана ошибки нет", async ({ page }) => {
    const settings = projectPath(ctx, "/settings");
    const typed = "Изменение, которое не дойдёт до сервера";
    await page.goto(settings);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(BASELINE_MS);
    await page.locator("#description").fill(typed);

    const restore = await cutActions(page);
    await page.getByRole("link", { name: "Обзор", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Сохранить" }).click();

    // Раньше вопрос ждал ответа до 30 секунд.
    await expect(page.getByText(NO_CONNECTION).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${settings}$`));
    await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    await expect(page.locator("#description")).toHaveValue(typed);
    await restore();
  });

  test("настоящее падение: вопрос закрывается сразу, экран ошибки, «Повторить» возвращает страницу", async ({ page }) => {
    const settings = projectPath(ctx, "/settings");
    await page.goto(settings);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(BASELINE_MS);
    await page.locator("#description").fill("Изменение, на котором сервер упал");

    const crash = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      if (!route.request().headers()["next-action"]) return route.fallback();
      await route.fulfill({ status: 500, contentType: "text/plain", body: "Сбой сервера" });
    };
    await page.route("**/*", crash);
    await page.getByRole("link", { name: "Обзор", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Сохранить" }).click();

    await expect(page.getByText("Что-то пошло не так")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${settings}$`));
    await expect(page.getByRole("link", { name: "Обзор", exact: true })).toBeVisible();

    await page.unroute("**/*", crash);
    await page.getByRole("button", { name: "Повторить" }).click();
    await expect(page.locator("#name")).toBeVisible();
  });
});
