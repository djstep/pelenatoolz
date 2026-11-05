import path from "node:path";
import { Prisma } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { CREW, E2E_ROLE_NAMES, NAMES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { workbookText } from "./helpers/leaks";
import { downloadBuffer, e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 8, шаг 4: экспорт и печать команды. Права проверяются по содержимому файла, HTML окна
 * печати и ответам сервера, в том числе на подделанные запросы мимо экрана.
 */

const ctx = e2eContext();
const db = e2eDb();
const CREW_PATH = projectPath(ctx, "/crew");
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ORIGIN = new URL(BASE_URL).origin;

const LINKED = CREW.linked;
const MANUAL = CREW.manual;
const CONTRACT_NUMBER = CREW.contracts.individual.number;
const CONTACTS = [LINKED.phone, LINKED.email, MANUAL.phone, MANUAL.email];
const AMOUNT_PARTS = [CREW.contractAmount, CREW.contractAmount.replace(".", ",")];
const ARCHIVED = { lastName: "Времянкин-Архивный", firstName: "Павел", phone: "+7 900 000-11-22" };

/** Колонки, какие мог бы прислать подделанный запрос. */
const ALL_FIELD_IDS = [
  "department",
  "fullName",
  "position",
  "phone",
  "email",
  "source",
  "contractNumber",
  "contractDate",
  "contractStatus",
  "note",
];
const FORGED_COLUMNS = [
  ...ALL_FIELD_IDS.map((id) => ({ id, title: id, fieldIds: [id] })),
  { id: "secret", title: "Сумма", fieldIds: ["amountWithVat", "syncedValues"] },
];

const actions = { save: "" };

function captureActions(page: Page) {
  const ids: string[] = [];
  page.on("request", (request) => {
    const id = request.headers()["next-action"];
    if (id) ids.push(id);
  });
  return ids;
}

/** Вызов действия напрямую, мимо экрана: как подделанный запрос. */
async function callAction(page: Page, actionId: string, args: unknown[]) {
  const res = await page.request.post(CREW_PATH, {
    headers: {
      "next-action": actionId,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      origin: ORIGIN,
    },
    data: JSON.stringify(args),
  });
  return { status: res.status(), body: await res.text() };
}

function fileFromResponse(body: string) {
  // Длинная строка приходит отдельным куском ответа; файл xlsx (zip) начинается с «PK» — «UEsDB».
  const base64 = body.match(/UEsDB[A-Za-z0-9+/=]+/)?.[0];
  expect(base64, "в ответе есть файл").toBeTruthy();
  return workbookText(Buffer.from(base64!, "base64"));
}

function expectNoAmount(text: string) {
  const compact = text.replace(/\s/g, "");
  for (const part of AMOUNT_PARTS) expect(compact).not.toContain(part);
  expect(text).not.toContain("amountWithVat");
  expect(text).not.toContain("syncedValues");
}

function expectNoContacts(text: string) {
  for (const value of CONTACTS) expect(text).not.toContain(value);
}

function expectNoContracts(text: string) {
  expect(text).not.toContain(CONTRACT_NUMBER);
  expect(text).not.toContain("Номер договора");
}

/** layoutBodies — сюда попадёт ответ сервера с раскладкой, если тест проверяет его содержимое. */
async function openExport(page: Page, item: "Excel" | "Печать", layoutBodies?: string[]) {
  await page.goto(CREW_PATH);
  // Запросы после загрузки могут оборвать действие, отправленное сразу же.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  // Окно один раз запрашивает раскладку: ждём ответ и читаем его до следующих шагов теста.
  const layout = page.waitForResponse((res) => Boolean(res.request().headers()["next-action"]));
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const body = await (await layout).text();
  layoutBodies?.push(body);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);
  return dialog;
}

async function downloadExcel(page: Page) {
  const dialog = page.getByRole("dialog");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Экспортировать Excel" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Команда · \d{4}-\d{2}-\d{2}\.xlsx$/);
  return workbookText(await downloadBuffer(download));
}

async function openPrint(page: Page) {
  const dialog = page.getByRole("dialog");
  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Печать", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Команда", exact: true })).toBeVisible();
  await expect(popup.getByText("Готовим лист к печати")).toHaveCount(0);
  return popup;
}

/** Заголовки колонок в конструкторе: то, что реально предложено человеку. */
async function builderTitles(page: Page) {
  const inputs = page.getByRole("dialog").getByPlaceholder("Заголовок");
  return inputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
}

async function setRoleSection(section: string, value: Record<string, boolean>) {
  const role = await db.projectRoleDefinition.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: E2E_ROLE_NAMES.crewonly },
    select: { id: true, permissions: true },
  });
  const permissions = role.permissions as Record<string, Record<string, boolean>>;
  await db.projectRoleDefinition.update({
    where: { id: role.id },
    data: { permissions: { ...permissions, [section]: { ...permissions[section], ...value } } },
  });
}

const setContractRight = (on: boolean) => setRoleSection("contracts", { access: on, read: on });

async function exportSettings() {
  const project = await db.project.findUniqueOrThrow({
    where: { id: ctx.projectId },
    select: { exportSettings: true },
  });
  return (project.exportSettings ?? {}) as Record<string, unknown>;
}

async function setCrewLayout(layout: unknown) {
  const settings = await exportSettings();
  delete settings.crew;
  await db.project.update({
    where: { id: ctx.projectId },
    data: { exportSettings: (layout ? { ...settings, crew: layout } : settings) as Prisma.InputJsonValue },
  });
}

async function removeArchived() {
  await db.crewMember.deleteMany({ where: { projectId: ctx.projectId, lastName: ARCHIVED.lastName } });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await removeArchived();
  await setCrewLayout(null);
  await setContractRight(false);
  const creator = await db.crewMember.findFirstOrThrow({
    where: { projectId: ctx.projectId, lastName: LINKED.lastName },
    select: { createdById: true, departmentId: true },
  });
  await db.crewMember.create({
    data: { projectId: ctx.projectId, ...ARCHIVED, ...creator, archivedAt: new Date() },
  });
});

test.afterAll(async () => {
  await setRoleSection("crew", { access: true, read: true });
  await setContractRight(false);
  await setCrewLayout(null);
  await removeArchived();
  await db.$disconnect();
});

test.describe("продюсер", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("Excel: контакты и договоры есть, архива и сумм нет, раскладка сохранилась", async ({ page }) => {
    const dialog = await openExport(page, "Excel");
    expect(await builderTitles(page)).toEqual([
      "Цех",
      "ФИО",
      "Должность",
      "Телефон",
      "Почта",
      "Источник",
      "Номер договора",
      "Дата договора",
      "Статус договора",
      "Заметка",
    ]);
    await expect(dialog.getByText("Настройки колонок не сохранятся")).toHaveCount(0);

    // Первый запрос с колонками — сохранение раскладки, за ним выгрузка.
    const saveRequest = page.waitForRequest((r) => (r.postData() ?? "").includes('"fieldIds"'));
    const text = await downloadExcel(page);
    actions.save = (await saveRequest).headers()["next-action"];
    for (const value of CONTACTS) expect(text).toContain(value);
    expect(text).toContain(CONTRACT_NUMBER);
    expect(text).toContain(NAMES.transportDepartment);
    expect(text).not.toContain(ARCHIVED.lastName);
    expectNoAmount(text);
    expect((await exportSettings()).crew).toBeTruthy();
  });

  test("Excel: архив только по галочке, с пометкой в цехе", async ({ page }) => {
    const dialog = await openExport(page, "Excel");
    await dialog.getByText("Включить людей из архива").click();
    const text = await downloadExcel(page);
    expect(text).toContain(ARCHIVED.lastName);
    expect(text).toContain(`${NAMES.transportDepartment} (архив)`);
  });

  test("конструктор: столбец убирается из файла, «Доп. ресурсов» нет", async ({ page }) => {
    const dialog = await openExport(page, "Excel");
    await dialog.getByRole("button", { name: "Меню столбца" }).first().click();
    await expect(page.getByRole("menuitem", { name: "Доп. ресурсы" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Удалить столбец" }).click();
    expect(await builderTitles(page)).not.toContain("Цех");
    expect(await downloadExcel(page)).not.toContain(NAMES.transportDepartment);
    await setCrewLayout(null);
  });

  test("печать: группы по цехам, Medeo Sans, без колонтитула, белый лист в обеих темах", async ({ page }, testInfo) => {
    await openExport(page, "Печать");
    const popup = await openPrint(page);

    const group = popup.locator("tbody", { hasText: LINKED.lastName });
    await expect(group.getByRole("rowheader", { name: NAMES.transportDepartment })).toBeVisible();
    await expect(group).toContainText(LINKED.phone);
    await expect(group).toContainText(CONTRACT_NUMBER);
    await expect(popup.getByRole("columnheader", { name: "Цех" })).toHaveCount(0);
    await expect(popup.getByText(ARCHIVED.lastName)).toHaveCount(0);

    const html = await popup.content();
    expectNoAmount(html);
    expect(html).not.toMatch(/лист\s+\d|counter\(page/i);
    expect(await popup.evaluate(() => document.fonts.check('12px "Medeo Sans"'))).toBe(true);
    expect(
      await popup.evaluate(() => getComputedStyle(document.body).fontFamily),
    ).toContain("Medeo Sans");

    const dir = process.env.E2E_STATE_SHOTS;
    if (dir) await popup.pdf({ path: path.join(dir, "crew-print.pdf"), preferCSSPageSize: true }).catch(() => undefined);
    await testInfo.attach("crew-print.html", { body: html.replace(/base64,[^)]+/g, "base64,…"), contentType: "text/html" });
    await popup.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`печать из темы «${theme}»: лист белый, окно настроек по теме`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      const dialog = await openExport(page, "Печать");
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const dir = process.env.E2E_STATE_SHOTS;
      if (dir) await dialog.screenshot({ path: path.join(dir, `crew-export-modal-${theme}.png`) });

      const popup = await openPrint(page);
      await popup.emulateMedia({ colorScheme: theme });
      expect(await popup.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
      expect(await popup.evaluate(() => getComputedStyle(document.body).color)).toBe("rgb(18, 18, 18)");
      if (dir) await popup.screenshot({ path: path.join(dir, `crew-print-${theme}.png`), fullPage: true });
      await popup.close();
    });
  }

  test("«Обновить из договора» недоступно при несохранённых правках", async ({ page }) => {
    await page.goto(CREW_PATH);
    await page
      .getByRole("button", { name: `${LINKED.lastName} ${LINKED.firstName} ${LINKED.middleName}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const update = dialog.getByRole("button", { name: "Обновить из договора" });
    const position = dialog.getByLabel("Должность");
    const hint = dialog.getByText("сначала сохраните или отмените правки");
    await expect(update).toBeEnabled();
    await expect(hint).toHaveCount(0);

    await position.fill(`${LINKED.position} главный`);
    await expect(update).toBeDisabled();
    await expect(hint).toBeVisible();

    // Вернули как было — правок больше нет.
    await position.fill(LINKED.position);
    await expect(update).toBeEnabled();
    await expect(hint).toHaveCount(0);

    // Цех — выпадающий список, он меняет поле не вводом с клавиатуры.
    await dialog.locator("#crew-department-trigger").click();
    await page.getByRole("option", { name: "Без цеха" }).click();
    await expect(update).toBeDisabled();
    await expect(hint).toBeVisible();
  });
});

test.describe("без контактов и договоров", () => {
  test.use({ storageState: storageStatePath("crewonly") });

  test("в конструкторе нет запрещённых колонок, файл без них", async ({ page }) => {
    const dialog = await openExport(page, "Excel");
    expect(await builderTitles(page)).toEqual(["Цех", "ФИО", "Должность", "Источник", "Заметка"]);
    await expect(dialog.getByText("Настройки колонок не сохранятся")).toBeVisible();

    await dialog.getByRole("button", { name: "+", exact: true }).first().click();
    const offered = page.locator(".glass-dropdown-item");
    await expect(offered.filter({ hasText: "Заметка" })).toBeVisible();
    for (const name of ["Телефон", "Почта", "Номер договора", "Дата договора", "Статус договора"]) {
      await expect(offered.filter({ hasText: name })).toHaveCount(0);
    }
    await openExport(page, "Excel");

    const text = await downloadExcel(page);
    expect(text).toContain(LINKED.lastName);
    expect(text).toContain("из договора");
    expectNoContacts(text);
    expectNoContracts(text);
    expectNoAmount(text);
  });

  test("подделанный запрос: чужих колонок нет ни в файле, ни в печати", async ({ page }) => {
    const ids = captureActions(page);
    await openExport(page, "Excel");
    await downloadExcel(page);
    const exportId = ids.at(-1)!;

    const xlsx = await callAction(page, exportId, [ctx.projectId, { format: "xlsx", columns: FORGED_COLUMNS }]);
    expect(xlsx.status).toBe(200);
    const text = await fileFromResponse(xlsx.body);
    expect(text).toContain(LINKED.lastName);
    expectNoContacts(text);
    expectNoContracts(text);
    expectNoAmount(text);

    const print = await callAction(page, exportId, [ctx.projectId, { format: "pdf", columns: FORGED_COLUMNS }]);
    expect(print.status).toBe(200);
    expect(print.body).toContain(LINKED.lastName);
    expectNoContacts(print.body);
    expectNoContracts(print.body);
    expectNoAmount(print.body);

    const onlyForbidden = await callAction(page, exportId, [
      ctx.projectId,
      { format: "xlsx", columns: [{ id: "a", title: "Телефон", fieldIds: ["phone", "email"] }] },
    ]);
    expect(onlyForbidden.body).toContain("Добавьте хотя бы один столбец");
    expect(onlyForbidden.body).not.toContain('"base64"');
  });

  test("печать: контактов и договоров нет в HTML", async ({ page }) => {
    await openExport(page, "Печать");
    const popup = await openPrint(page);
    await expect(popup.getByRole("cell", { name: `${LINKED.lastName} ${LINKED.firstName}` })).toBeVisible();
    const html = await popup.content();
    expectNoContacts(html);
    expectNoContracts(html);
    expectNoAmount(html);
    await popup.close();
  });

  test("раскладка проекта: чужие колонки не приходят, подделанное сохранение отказывает", async ({ page }) => {
    const layout = {
      columns: [
        { id: "a", title: "Звонить сюда", fieldIds: ["phone"] },
        { id: "b", title: "ФИО", fieldIds: ["fullName"] },
      ],
    };
    await setCrewLayout(layout);

    const ids = captureActions(page);
    const layoutBodies: string[] = [];
    await openExport(page, "Excel", layoutBodies);
    expect(await builderTitles(page)).toEqual(["ФИО"]);
    expect(layoutBodies.join("\n")).not.toContain("Звонить сюда");
    expect(ids.length).toBeGreaterThan(0);

    const forged = await callAction(page, actions.save, [
      ctx.projectId,
      "crew",
      [{ id: "x", title: "Затёрто", fieldIds: ["fullName"] }],
    ]);
    expect(forged.body).toContain("Недостаточно прав");
    expect((await exportSettings()).crew).toEqual(layout);
    await setCrewLayout(null);
  });

  test("без просмотра команды выгрузка отказывает", async ({ page }) => {
    const ids = captureActions(page);
    await openExport(page, "Excel");
    await downloadExcel(page);
    const exportId = ids.at(-1)!;

    await setRoleSection("crew", { access: false, read: false });
    try {
      const refused = await callAction(page, exportId, [ctx.projectId, { format: "xlsx", columns: FORGED_COLUMNS }]);
      expect(refused.body).toContain("Недостаточно прав");
      expect(refused.body).not.toContain(LINKED.lastName);
      expect(refused.body).not.toContain('"base64"');
    } finally {
      await setRoleSection("crew", { access: true, read: true });
    }
  });
});

test.describe("договоры есть, контактов нет", () => {
  test.use({ storageState: storageStatePath("crewonly") });
  test.beforeAll(() => setContractRight(true));
  test.afterAll(() => setContractRight(false));

  test("номер договора в файле и печати, телефонов нет, сумм нет", async ({ page }) => {
    const dialog = await openExport(page, "Excel");
    expect(await builderTitles(page)).toContain("Номер договора");
    expect(await builderTitles(page)).not.toContain("Телефон");
    await expect(dialog.getByText("Настройки колонок не сохранятся")).toBeVisible();
    const text = await downloadExcel(page);
    expect(text).toContain(CONTRACT_NUMBER);
    expectNoContacts(text);
    expectNoAmount(text);

    await openExport(page, "Печать");
    const popup = await openPrint(page);
    await expect(popup.locator("body")).toContainText(CONTRACT_NUMBER);
    const html = await popup.content();
    expectNoContacts(html);
    expectNoAmount(html);
    await popup.close();
  });
});
