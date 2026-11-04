import { expect, test, type Page } from "@playwright/test";
import { CREW, E2E_ROLE_NAMES, E2E_ROLES, NAMES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, fetchRsc, projectPath, sniff, storageStatePath } from "./helpers/session";

/**
 * Волна 8: раздел «Команда». Права проверяются по ответу сервера (документ, `?_rsc`, ответы
 * действий), а не только по экрану. «Подтянуть» и договоры — `c16-crew-contracts.spec.ts`.
 */

const ctx = e2eContext();
const db = e2eDb();
const CREW_PATH = projectPath(ctx, "/crew");
const TMP_LAST_NAME = "Времянкин";
const LINKED = CREW.linked;
const MANUAL = CREW.manual;
const SECRETS = [LINKED.phone, LINKED.email, MANUAL.phone, MANUAL.email];
const CONTRACT_NUMBER = CREW.contracts.individual.number;
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const AMOUNT_PARTS = [CREW.contractAmount, CREW.contractAmount.replace(".", ",")];

/** Все ответы страницы: документ при открытии, `?_rsc`, что пришло по пути. */
async function serverBodies(page: Page) {
  const sniffer = sniff(page);
  await page.goto(CREW_PATH);
  await expect(page.getByRole("heading", { name: "Команда", exact: true })).toBeVisible();
  const rsc = await fetchRsc(page, CREW_PATH);
  return [...(await sniffer.done()).map((c) => c.body), rsc.body];
}

function expectNoAmount(bodies: string[]) {
  for (const body of bodies) {
    const compact = body.replace(/\s/g, "");
    for (const part of AMOUNT_PARTS) expect(compact).not.toContain(part);
    expect(body).not.toContain("amountWithVat");
  }
}

function row(page: Page, lastName: string) {
  return page.locator("main tbody tr").filter({ hasText: lastName });
}

async function cleanup() {
  await db.crewMember.deleteMany({ where: { projectId: ctx.projectId, lastName: { startsWith: TMP_LAST_NAME } } });
}

test.beforeAll(cleanup);
test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

test.describe("права «Команда» в матрице ролей", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("новая роль: просмотр команды отмечен, правка и контакты — нет", async ({ page }) => {
    await page.goto(projectPath(ctx, "/roles"));
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "+ Добавить роль" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("cell", { name: "Команда", exact: true })).toBeVisible();
    await expect(dialog.getByRole("cell", { name: "Команда: контакты", exact: true })).toBeVisible();

    const box = (name: string) => dialog.locator(`input[type=checkbox][name$="_${name}"]`);
    await expect(box("crew_read")).toBeChecked();
    await expect(box("crew_update")).not.toBeChecked();
    await expect(box("crew_contacts_access")).not.toBeChecked();
    // Создания и удаления у «Команды» нет: людей отправляют в архив.
    await expect(box("crew_create")).toHaveCount(0);
    await expect(box("crew_delete")).toHaveCount(0);
    await expect(box("crew_contacts_read")).toHaveCount(0);
  });
});

test.describe("меню", () => {
  test.use({ storageState: storageStatePath("crewonly") });

  test("«Команда» сразу после «Вызывных»", async ({ page }) => {
    await page.goto(CREW_PATH);
    const labels = await page
      .locator("nav a, aside a")
      .evaluateAll((links) => links.map((a) => a.textContent?.trim() ?? ""));
    const index = labels.indexOf("Вызывные");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(labels[index + 1]).toBe("Команда");
  });
});

test.describe("с контактами и договорами", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("продюсер: телефоны, почта, договор; сумм нет", async ({ page }) => {
    const bodies = await serverBodies(page);
    await expect(row(page, LINKED.lastName)).toContainText(LINKED.phone);
    await expect(row(page, LINKED.lastName)).toContainText(LINKED.email);
    await expect(row(page, LINKED.lastName)).toContainText(CONTRACT_NUMBER);
    await expect(row(page, LINKED.lastName)).toContainText("из договора");
    await expect(row(page, MANUAL.lastName)).toContainText("вручную");
    const tel = row(page, LINKED.lastName).getByRole("link", { name: LINKED.phone });
    await expect(tel).toHaveAttribute("href", "tel:+79001112233");
    expectNoAmount(bodies);
  });

  test("колонки «Цех» нет: цех — заголовок группы, и при поиске тоже", async ({ page }) => {
    await page.goto(CREW_PATH);
    const group = page.locator(`tbody[data-crew-group="${NAMES.transportDepartment}"]`);
    await expect(group).toContainText(LINKED.lastName);
    await expect(page.getByRole("columnheader", { name: "Цех" })).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Поиск" }).fill(LINKED.lastName);
    await expect(group).toContainText(LINKED.lastName);
    await expect(group.getByRole("rowheader", { name: NAMES.transportDepartment })).toBeVisible();
  });

  test("в поиске телефон в другом написании находит человека", async ({ page }) => {
    await page.goto(CREW_PATH);
    await page.getByRole("searchbox", { name: "Поиск" }).fill("8 900 777");
    await expect(row(page, MANUAL.lastName)).toBeVisible();
    await expect(row(page, LINKED.lastName)).toHaveCount(0);
  });

  test("добавить, изменить, в архив, вернуть; журнал без телефона и почты", async ({ page }) => {
    const phone = "+7 900 555-44-33";
    const email = "tmp-crew@e2e.test";
    const phone2 = "+7 900 555-44-00";
    await page.goto(CREW_PATH);
    await page.waitForLoadState("networkidle");

    // Добавить.
    await page.getByRole("button", { name: "Добавить вручную" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("input[name=lastName]").fill(TMP_LAST_NAME);
    await dialog.locator("input[name=firstName]").fill("Сергей");
    await dialog.locator("input[name=position]").fill("Грузчик");
    await dialog.locator("select[name=departmentId]").selectOption({ label: NAMES.transportDepartment });
    await dialog.locator("input[name=phone]").fill(phone);
    await dialog.locator("input[name=email]").fill(email);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(row(page, TMP_LAST_NAME)).toContainText("Грузчик");
    await expect(row(page, TMP_LAST_NAME)).toContainText(phone);

    // Изменить.
    await row(page, TMP_LAST_NAME).getByRole("button", { name: new RegExp(`^${TMP_LAST_NAME}`) }).click();
    await dialog.locator("input[name=position]").fill("Бригадир");
    await dialog.locator("input[name=phone]").fill(phone2);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(row(page, TMP_LAST_NAME)).toContainText("Бригадир");
    await expect(row(page, TMP_LAST_NAME)).toContainText(phone2);

    // В архив: из работающих ушёл, в архиве виден.
    await row(page, TMP_LAST_NAME).getByRole("button", { name: new RegExp(`^${TMP_LAST_NAME}`) }).click();
    await dialog.getByRole("button", { name: "В архив" }).click();
    await expect(row(page, TMP_LAST_NAME)).toHaveCount(0);
    await page.getByRole("button", { name: /^Архив/ }).click();
    await expect(row(page, TMP_LAST_NAME)).toBeVisible();

    // Вернуть. Запись та же: архив не удаляет.
    await row(page, TMP_LAST_NAME).getByRole("button", { name: new RegExp(`^${TMP_LAST_NAME}`) }).click();
    await dialog.getByRole("button", { name: "Вернуть из архива" }).click();
    await expect(row(page, TMP_LAST_NAME)).toHaveCount(0);
    await page.getByRole("button", { name: /^В работе/ }).click();
    await expect(row(page, TMP_LAST_NAME)).toBeVisible();

    const member = await db.crewMember.findFirstOrThrow({
      where: { projectId: ctx.projectId, lastName: TMP_LAST_NAME },
      select: { id: true, phone: true, archivedAt: true },
    });
    expect(member.phone).toBe(phone2);
    expect(member.archivedAt).toBeNull();

    const logs = await db.auditLog.findMany({
      where: { projectId: ctx.projectId, entityType: "crew_member", entityId: member.id },
      select: { summary: true, changes: true },
    });
    expect(logs.length).toBe(4);
    const text = JSON.stringify(logs);
    for (const secret of [phone, phone2, email]) expect(text).not.toContain(secret);
    expect(text).toContain("Телефон");
  });

  test("порядок внутри цеха меняется перетаскиванием", async ({ page }) => {
    const names = ["ВремянкинА", "ВремянкинБ"];
    const owner = await db.user.findFirstOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } });
    const department = await db.department.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: NAMES.smetaDepartment },
      select: { id: true },
    });
    for (const lastName of names) {
      await db.crewMember.create({
        data: { projectId: ctx.projectId, lastName, departmentId: department.id, createdById: owner.id },
      });
    }

    await page.goto(CREW_PATH);
    await page.waitForLoadState("networkidle");
    const group = page.locator(`tbody[data-crew-group="${NAMES.smetaDepartment}"]`);
    const handle = group.getByRole("button", { name: `Перетащить: ${names[1]}` });
    const target = group.getByRole("button", { name: `Перетащить: ${names[0]}` });
    const from = await handle.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("Нет ручек перетаскивания");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y - 6, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 - 4, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const rows = await db.crewMember.findMany({
          where: { projectId: ctx.projectId, departmentId: department.id },
          orderBy: { sortOrder: "asc" },
          select: { lastName: true, sortOrder: true },
        });
        return rows.map((r) => `${r.lastName}:${r.sortOrder}`);
      })
      .toEqual([`${names[1]}:1`, `${names[0]}:2`]);
    await page.reload();
    await expect(group.locator("tr td button.text-left")).toHaveText([names[1], names[0]]);
  });
});

test.describe("с договорами, без денег", () => {
  test.use({ storageState: storageStatePath("nofin") });

  test("номер и статус договора видны, суммы — нет", async ({ page }) => {
    const bodies = await serverBodies(page);
    await expect(row(page, LINKED.lastName)).toContainText(CONTRACT_NUMBER);
    await expect(row(page, LINKED.lastName)).toContainText("Не подписан");
    expectNoAmount(bodies);
  });
});

test.describe("без контактов и без договоров", () => {
  test.use({ storageState: storageStatePath("crewonly") });

  test("список виден; контактов и договоров нет ни на экране, ни в ответах сервера", async ({ page }) => {
    const bodies = await serverBodies(page);
    await expect(row(page, LINKED.lastName)).toContainText(LINKED.position);
    await expect(row(page, MANUAL.lastName)).toContainText(MANUAL.note);
    // Без деталей: только что запись из договора.
    await expect(row(page, LINKED.lastName)).toContainText("из договора");
    await expect(page.getByRole("columnheader", { name: "Телефон" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Почта" })).toHaveCount(0);

    let crewRows = 0;
    for (const body of bodies) {
      for (const secret of SECRETS) expect(body).not.toContain(secret);
      expect(body).not.toContain(CONTRACT_NUMBER);
      expect(body).not.toContain("Не подписан");
      expect(body).not.toContain("syncedValues");
      // Строки команды в данных страницы: ключей нет даже с пустым значением.
      // (В шапке страницы своя почта зрителя, поэтому смотрим именно строки.)
      for (const crewRow of body.match(/lastName[^}]*sortOrder[^}]*/g) ?? []) {
        crewRows += 1;
        expect(crewRow).not.toMatch(/phone|email|contracts/);
      }
    }
    expect(crewRows).toBeGreaterThan(0);
    expectNoAmount(bodies);
  });

  test("поиск по телефону ничего не находит, по фамилии — находит", async ({ page }) => {
    await page.goto(CREW_PATH);
    const search = page.getByRole("searchbox", { name: "Поиск" });
    await search.fill(MANUAL.phone);
    await expect(page.getByText("Никого не нашли.")).toBeVisible();
    await search.fill("900 777");
    await expect(page.getByText("Никого не нашли.")).toBeVisible();
    await search.fill(MANUAL.lastName);
    await expect(row(page, MANUAL.lastName)).toBeVisible();
  });

  test("в карточке нет полей контактов и договоров; правка не стирает контакты", async ({ page }) => {
    await page.goto(CREW_PATH);
    await page.waitForLoadState("networkidle");
    await row(page, LINKED.lastName).getByRole("button", { name: new RegExp(`^${LINKED.lastName}`) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("input[name=lastName]")).toHaveValue(LINKED.lastName);
    await expect(dialog.locator("input[name=phone]")).toHaveCount(0);
    await expect(dialog.locator("input[name=email]")).toHaveCount(0);
    await expect(dialog).toContainText("Из договора");
    await expect(dialog).not.toContainText(CONTRACT_NUMBER);

    const note = `Правка без контактов ${Date.now()}`;
    await dialog.locator("textarea[name=note]").fill(note);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(row(page, LINKED.lastName)).toContainText(note);

    const member = await db.crewMember.findFirstOrThrow({
      where: { projectId: ctx.projectId, lastName: LINKED.lastName },
      select: { id: true, phone: true, email: true },
    });
    expect(member.phone).toBe(LINKED.phone);
    expect(member.email).toBe(LINKED.email);
    await db.crewMember.update({ where: { id: member.id }, data: { note: null } });
  });

  test("правка без контактов: у того, кому контакты видны, телефон и почта на месте", async ({ page, browser }) => {
    await page.goto(CREW_PATH);
    await page.waitForLoadState("networkidle");
    await row(page, MANUAL.lastName).getByRole("button", { name: new RegExp(`^${MANUAL.lastName}`) }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("input[name=phone]")).toHaveCount(0);
    const position = `Водитель ${Date.now()}`;
    await dialog.locator("input[name=position]").fill(position);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(row(page, MANUAL.lastName)).toContainText(position);

    const producer = await browser.newContext({
      baseURL: BASE_URL,
      storageState: storageStatePath("producer"),
    });
    try {
      const other = await producer.newPage();
      await other.goto(CREW_PATH);
      const person = row(other, MANUAL.lastName);
      await expect(person).toContainText(position);
      await expect(person).toContainText(MANUAL.phone);
      await expect(person).toContainText(MANUAL.email);
    } finally {
      await producer.close();
      await db.crewMember.updateMany({
        where: { projectId: ctx.projectId, lastName: MANUAL.lastName },
        data: { position: MANUAL.position },
      });
    }
  });

  test("договоры закрыты, а без «Команды» закрыт и экран", async ({ page }) => {
    await page.goto(projectPath(ctx, "/counterparties/contracts"));
    await expect(page.getByText(CONTRACT_NUMBER)).toHaveCount(0);

    const role = await db.projectRoleDefinition.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: E2E_ROLE_NAMES.crewonly },
      select: { id: true, permissions: true },
    });
    const permissions = role.permissions as Record<string, Record<string, boolean>>;
    await db.projectRoleDefinition.update({
      where: { id: role.id },
      data: { permissions: { ...permissions, crew: { ...permissions.crew, access: false, read: false } } },
    });
    try {
      const sniffer = sniff(page);
      await page.goto(CREW_PATH);
      await expect(page.getByText("Нет доступа к команде")).toBeVisible();
      await expect(page.getByRole("link", { name: "Команда", exact: true })).toHaveCount(0);
      for (const { body } of await sniffer.done()) expect(body).not.toContain(LINKED.position);
    } finally {
      await db.projectRoleDefinition.update({ where: { id: role.id }, data: { permissions } });
    }
  });
});
