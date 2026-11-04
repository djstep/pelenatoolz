import { expect, test, type Locator, type Page } from "@playwright/test";
import { CounterpartyType } from "@prisma/client";
import { CREW, E2E_ROLE_NAMES, E2E_ROLES, NAMES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, sniff, storageStatePath } from "./helpers/session";

/**
 * Волна 8, шаг 3: команда и договоры. Окно «Подтянуть», «Связать с договором», «Обновить из
 * договора», пометки. Права — по ответам сервера: действия вызываются и напрямую, как это
 * сделал бы подделанный запрос. Тесты идут по порядку: id действий берутся из первого.
 */

const ctx = e2eContext();
const db = e2eDb();
const CREW_PATH = projectPath(ctx, "/crew");
const ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;

const K2 = CREW.contracts.selfEmployed;
const K3 = CREW.contracts.ip;
const K4 = CREW.contracts.llc;

const TEMP_PREFIX = "E2E-КТ";
const TEMP_COUNTERPARTIES = {
  rejected: { name: "Отказов Пётр", contacts: null, type: "INDIVIDUAL", number: `${TEMP_PREFIX}1` },
  similar: { name: "Дублев Олег Петрович", contacts: "+7 900 666-00-11", type: "INDIVIDUAL", number: `${TEMP_PREFIX}2` },
  hidden: {
    name: "Беззвонков Иван Ильич",
    contacts: "+7 900 444-55-66, hidden@e2e.test",
    type: "SELF_EMPLOYED",
    number: `${TEMP_PREFIX}3`,
  },
  forged: { name: "Подделкин Иван", contacts: "+7 900 777-00-22", type: "INDIVIDUAL", number: `${TEMP_PREFIX}4` },
  fate: { name: "Судьбин Павел", contacts: "+7 900 888-00-33", type: "IP", number: `${TEMP_PREFIX}5` },
} as const;
type TempKey = keyof typeof TEMP_COUNTERPARTIES;

const TEMP_NAMES: string[] = Object.values(TEMP_COUNTERPARTIES).map((c) => c.name);
/** Все, кого тесты добавляют в команду. Сид («Светов», «Вручнов») не трогаем. */
const CREW_LAST_NAMES = ["Гримова", "Звуков", "Дублев", "Беззвонков", "Подделкин", "Судьбин", "Оооов", "Кранова"];

async function seedRefs() {
  const [company, unsigned, producer, smeta] = await Promise.all([
    db.company.findFirstOrThrow({ where: { projectId: ctx.projectId, name: NAMES.company }, select: { id: true } }),
    db.projectApprovalStatus.findFirstOrThrow({
      where: { projectId: ctx.projectId, key: "UNSIGNED" },
      select: { id: true },
    }),
    db.user.findFirstOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } }),
    db.department.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: NAMES.smetaDepartment },
      select: { id: true },
    }),
  ]);
  return { company, unsigned, producer, smeta };
}

async function statusId(key: string) {
  const status = await db.projectApprovalStatus.findFirstOrThrow({
    where: { projectId: ctx.projectId, key },
    select: { id: true },
  });
  return status.id;
}

async function addContract(number: string, counterpartyId: string, date = "2026-10-22") {
  const { company, unsigned } = await seedRefs();
  return db.contract.create({
    data: {
      projectId: ctx.projectId,
      date: new Date(`${date}T00:00:00.000Z`),
      number,
      companyId: company.id,
      counterpartyId,
      amount: CREW.contractAmount,
      vatEnabled: false,
      amountWithVat: CREW.contractAmount,
      statusId: unsigned.id,
    },
    select: { id: true },
  });
}

async function addTemp(key: TempKey) {
  const item = TEMP_COUNTERPARTIES[key];
  const counterparty = await db.counterparty.create({
    data: {
      projectId: ctx.projectId,
      name: item.name,
      type: item.type as CounterpartyType,
      contacts: item.contacts,
    },
    select: { id: true },
  });
  const contract = await addContract(item.number, counterparty.id);
  return { counterpartyId: counterparty.id, contractId: contract.id };
}

async function addManual(lastName: string, firstName: string) {
  const { producer } = await seedRefs();
  return db.crewMember.create({
    data: { projectId: ctx.projectId, lastName, firstName, createdById: producer.id },
    select: { id: true },
  });
}

async function cleanup() {
  await db.crewMember.deleteMany({
    where: { projectId: ctx.projectId, lastName: { in: CREW_LAST_NAMES } },
  });
  await db.accrual.deleteMany({
    where: { projectId: ctx.projectId, comment: "c16-crew" },
  });
  await db.contract.deleteMany({
    where: { projectId: ctx.projectId, number: { startsWith: TEMP_PREFIX } },
  });
  await db.counterparty.deleteMany({ where: { projectId: ctx.projectId, name: { in: TEMP_NAMES } } });
}

async function counterpartyByName(name: string) {
  return db.counterparty.findFirstOrThrow({
    where: { projectId: ctx.projectId, name },
    select: { id: true },
  });
}

async function contractByNumber(number: string) {
  return db.contract.findFirstOrThrow({
    where: { projectId: ctx.projectId, number },
    select: { id: true },
  });
}

function crewByLastName(lastName: string) {
  return db.crewMember.findMany({
    where: { projectId: ctx.projectId, lastName },
    include: { contractLinks: { include: { contract: { select: { number: true } } } } },
  });
}

async function openCrew(page: Page) {
  await page.goto(CREW_PATH);
  await page.waitForLoadState("networkidle");
}

function row(page: Page, lastName: string) {
  return page.locator("main tbody tr").filter({ hasText: lastName });
}

async function openPull(page: Page) {
  await page.getByRole("button", { name: "Подтянуть из договоров" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Загрузка…")).toHaveCount(0);
  return dialog;
}

function pullRow(dialog: Locator, counterparty: string) {
  return dialog.locator(`[data-testid="crew-pull-row"][data-counterparty="${counterparty}"]`);
}

async function openCard(page: Page, lastName: string) {
  await row(page, lastName).getByRole("button", { name: new RegExp(`^${lastName}`) }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog.locator("input[name=lastName]")).toHaveValue(lastName);
  return dialog;
}

/** Id серверных действий: заголовок `next-action` запросов страницы, по порядку. */
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

async function setContractRight(on: boolean) {
  const role = await db.projectRoleDefinition.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: E2E_ROLE_NAMES.crewonly },
    select: { id: true, permissions: true },
  });
  const permissions = role.permissions as Record<string, Record<string, boolean>>;
  await db.projectRoleDefinition.update({
    where: { id: role.id },
    data: { permissions: { ...permissions, contracts: { ...permissions.contracts, access: on, read: on } } },
  });
}

const actions = { load: "", pull: "", linkOptions: "", link: "", preview: "", apply: "" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await cleanup();
  await setContractRight(false);
});
test.afterAll(async () => {
  await setContractRight(false);
  await cleanup();
  await db.$disconnect();
});

test.describe("продюсер: подтянуть", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("в окне только физлица, самозанятые и ИП; ООО, отклонённых и связанных нет; сумм нет", async ({ page }) => {
    const rejected = await addTemp("rejected");
    await db.contract.update({
      where: { id: rejected.contractId },
      data: { statusId: await statusId("REJECTED") },
    });
    // Начисление по статье сметы — подстановка цеха.
    const { smeta } = await seedRefs();
    const item = await db.budgetItem.findFirstOrThrow({
      where: { projectId: ctx.projectId, departmentId: smeta.id },
      select: { id: true },
    });
    const k2Counterparty = await counterpartyByName(K2.counterparty);
    const k2Contract = await contractByNumber(K2.number);
    await db.accrual.create({
      data: {
        projectId: ctx.projectId,
        budgetItemId: item.id,
        counterpartyId: k2Counterparty.id,
        contractId: k2Contract.id,
        amount: CREW.contractAmount,
        amountWithTax: CREW.contractAmount,
        date: new Date("2026-10-23T00:00:00.000Z"),
        comment: "c16-crew",
      },
    });

    const ids = captureActions(page);
    const sniffer = sniff(page);
    await openCrew(page);
    const dialog = await openPull(page);
    await expect(pullRow(dialog, K2.counterparty)).toBeVisible();
    actions.load = ids[ids.length - 1];

    const grim = pullRow(dialog, K2.counterparty);
    await expect(grim).toContainText("Самозанятый");
    await expect(grim).toContainText(K2.number);
    await expect(grim).toContainText("Не подписан");
    await expect(grim.getByLabel("Фамилия")).toHaveValue("Гримова");
    await expect(grim.getByLabel("Имя", { exact: true })).toHaveValue("Анна");
    await expect(grim.getByLabel("Отчество")).toHaveValue("Сергеевна");
    await expect(grim.getByLabel("Телефон")).toHaveValue("8 (900) 222-33-44");
    await expect(grim.getByLabel("Почта")).toHaveValue("anna.grim@e2e.test");
    await expect(grim.getByLabel("Должность")).toHaveValue("");
    await expect(grim.getByLabel("Цех")).toHaveValue(smeta.id);

    const ip = pullRow(dialog, K3.counterparty);
    await expect(ip.getByLabel("Фамилия")).toHaveValue("Звуков");
    await expect(ip.getByLabel("Телефон")).toHaveValue("+7 900 333-44-55");
    await expect(ip.getByLabel("Почта")).toHaveValue("");

    await expect(pullRow(dialog, K4.counterparty)).toHaveCount(0);
    await expect(pullRow(dialog, CREW.contracts.individual.counterparty)).toHaveCount(0);
    await expect(pullRow(dialog, TEMP_COUNTERPARTIES.rejected.name)).toHaveCount(0);

    const compactAmount = CREW.contractAmount.replace(".", ",");
    for (const { body } of await sniffer.done()) {
      const compact = body.replace(/\s/g, "");
      expect(compact).not.toContain(CREW.contractAmount);
      expect(compact).not.toContain(compactAmount);
    }
  });

  test("поля правятся до сохранения; журнал без контактов и без номера в заголовке", async ({ page }) => {
    const ids = captureActions(page);
    await openCrew(page);
    const dialog = await openPull(page);
    const grim = pullRow(dialog, K2.counterparty);
    const ip = pullRow(dialog, K3.counterparty);

    await grim.getByLabel("Должность").fill("Гримёр");
    await expect(grim.getByRole("checkbox")).toBeChecked();
    await ip.getByLabel("Выбрать").check({ force: true });
    await ip.getByLabel("Имя", { exact: true }).fill("Олежек");
    await ip.getByLabel("Цех").selectOption({ label: NAMES.transportDepartment });
    await ip.getByLabel("Телефон").fill("+7 900 333-00-00");

    await dialog.getByRole("button", { name: "Добавить выбранных: 2" }).click();
    await expect(row(page, "Гримова")).toContainText("Гримёр");
    await expect(row(page, "Гримова")).toContainText(K2.number);
    await expect(row(page, "Звуков")).toContainText("Олежек");
    await expect(row(page, "Звуков")).toContainText("+7 900 333-00-00");
    actions.pull = ids[ids.length - 1] === actions.load ? "" : ids[ids.length - 1];
    expect(actions.pull).not.toBe("");

    const [person] = await crewByLastName("Звуков");
    expect(person.source).toBe("CONTRACT");
    expect(person.firstName).toBe("Олежек");
    expect(person.contractLinks.map((l) => l.contract.number)).toEqual([K3.number]);
    // В снимке — договор, а не правка в окне.
    expect(person.syncedValues).toMatchObject({ firstName: "Олег", phone: "+7 900 333-44-55" });

    const logs = await db.auditLog.findMany({
      where: { projectId: ctx.projectId, entityType: "crew_member", entityId: person.id },
      select: { summary: true, changes: true },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].summary).toContain("из договора");
    expect(logs[0].summary).not.toContain(K3.number);
    expect(JSON.stringify(logs[0].changes)).toContain(K3.number);
    expect(JSON.stringify(logs)).not.toContain("333-");
  });

  test("повторно подтянуть нельзя: в окне нет, подделанный запрос дубль не создаёт", async ({ page }) => {
    await openCrew(page);
    const dialog = await openPull(page);
    await expect(pullRow(dialog, K2.counterparty)).toHaveCount(0);
    await expect(pullRow(dialog, K3.counterparty)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Отмена" }).click();

    const { id: counterpartyId } = await counterpartyByName(K2.counterparty);
    const { status } = await callAction(page, actions.pull, [
      ctx.projectId,
      [{ mode: "create", counterpartyId, person: { lastName: "Гримова", firstName: "Вторая" } }],
    ]);
    expect(status).toBe(200);
    expect(await crewByLastName("Гримова")).toHaveLength(1);
  });

  test("новый договор того же контрагента связывается с тем же человеком", async ({ page }) => {
    const { id: counterpartyId } = await counterpartyByName(K2.counterparty);
    await addContract(`${TEMP_PREFIX}6`, counterpartyId);

    await openCrew(page);
    const dialog = await openPull(page);
    const grim = pullRow(dialog, K2.counterparty);
    await expect(grim).toContainText("Уже в команде: Гримова Анна Сергеевна");
    await expect(grim.getByLabel("Фамилия")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Отмена" }).click();

    // Даже запрос «создать» не создаёт второго.
    await callAction(page, actions.pull, [
      ctx.projectId,
      [{ mode: "create", counterpartyId, person: { lastName: "Гримова" } }],
    ]);
    const people = await crewByLastName("Гримова");
    expect(people).toHaveLength(1);
    expect(people[0].contractLinks.map((l) => l.contract.number).sort()).toEqual(
      [K2.number, `${TEMP_PREFIX}6`].sort(),
    );

    const again = await callAction(page, actions.pull, [
      ctx.projectId,
      [{ mode: "create", counterpartyId, person: { lastName: "Гримова" } }],
    ]);
    expect(again.status).toBe(200);
    expect((await crewByLastName("Гримова"))[0].contractLinks).toHaveLength(2);
  });

  test("похожее ФИО: предлагается связать с существующим, новой записи нет", async ({ page }) => {
    await addTemp("similar");
    const manual = await addManual("Дублев", "Олег");

    await openCrew(page);
    const dialog = await openPull(page);
    const similar = pullRow(dialog, TEMP_COUNTERPARTIES.similar.name);
    await expect(similar).toContainText("Возможно, уже есть: Дублев Олег");
    await expect(similar.locator("select").first()).toHaveValue(manual.id);
    await expect(similar.getByLabel("Фамилия")).toHaveCount(0);

    await similar.getByLabel("Выбрать").check({ force: true });
    await dialog.getByRole("button", { name: "Добавить выбранных: 1" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const people = await crewByLastName("Дублев");
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(manual.id);
    expect(people[0].source).toBe("CONTRACT");
    expect(people[0].contractLinks.map((l) => l.contract.number)).toEqual([
      TEMP_COUNTERPARTIES.similar.number,
    ]);
  });
});

test.describe("без договоров: только правка команды", () => {
  test.use({ storageState: storageStatePath("crewonly") });

  test("кнопки нет, а действия на сервере отказывают и данных не отдают", async ({ page }) => {
    await openCrew(page);
    await expect(page.getByRole("button", { name: "Подтянуть из договоров" })).toHaveCount(0);

    const manual = await addManual("Подделкин", "Иван");
    const load = await callAction(page, actions.load, [ctx.projectId]);
    expect(load.body).toContain("Недостаточно прав");
    expect(load.body).not.toContain(K2.counterparty);
    expect(load.body).not.toContain(K2.number);
    expect(load.body).not.toContain("anna.grim");

    const { id: counterpartyId } = await counterpartyByName(K3.counterparty);
    const pull = await callAction(page, actions.pull, [
      ctx.projectId,
      [{ mode: "link", counterpartyId, memberId: manual.id }],
    ]);
    expect(pull.body).toContain("Недостаточно прав");
    expect((await crewByLastName("Подделкин"))[0].contractLinks).toHaveLength(0);
    await db.crewMember.delete({ where: { id: manual.id } });
  });

  test("в карточке нет кнопок договоров", async ({ page }) => {
    await openCrew(page);
    const dialog = await openCard(page, CREW.linked.lastName);
    await expect(dialog.getByRole("button", { name: "Обновить из договора" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Связать с договором" })).toHaveCount(0);
  });
});

test.describe("договоры есть, контактов нет", () => {
  test.use({ storageState: storageStatePath("crewonly") });
  test.beforeAll(() => setContractRight(true));
  test.afterAll(() => setContractRight(false));

  test("окно без телефонов ни на экране, ни в ответе; в базу контакты не пишутся", async ({ page }) => {
    await addTemp("hidden");
    const sniffer = sniff(page);
    await openCrew(page);
    const dialog = await openPull(page);
    const hidden = pullRow(dialog, TEMP_COUNTERPARTIES.hidden.name);
    await expect(hidden.getByLabel("Фамилия")).toHaveValue("Беззвонков");
    await expect(hidden.getByLabel("Телефон")).toHaveCount(0);
    await expect(hidden.getByLabel("Почта")).toHaveCount(0);
    await expect(dialog).toContainText("нет права «Команда: контакты»");

    await hidden.getByLabel("Выбрать").check({ force: true });
    await dialog.getByRole("button", { name: "Добавить выбранных: 1" }).click();
    await expect(row(page, "Беззвонков")).toBeVisible();

    const bodies = (await sniffer.done()).map((c) => c.body);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain("444-55-66");
      expect(body).not.toContain("hidden@e2e.test");
      expect(body).not.toContain(K3.contacts);
    }

    const [person] = await crewByLastName("Беззвонков");
    expect(person.phone).toBeNull();
    expect(person.email).toBeNull();
    const snapshot = person.syncedValues as Record<string, unknown>;
    expect(snapshot.phone).toBeUndefined();
    expect(snapshot.email).toBeUndefined();
  });

  test("подделанный запрос с телефоном: сервер его не сохраняет", async ({ page }) => {
    const { counterpartyId } = await addTemp("forged");
    await openCrew(page);
    const { status } = await callAction(page, actions.pull, [
      ctx.projectId,
      [
        {
          mode: "create",
          counterpartyId,
          person: { lastName: "Подделкин", phone: "+7 900 000-00-01", email: "fake@e2e.test" },
        },
      ],
    ]);
    expect(status).toBe(200);
    const [person] = await crewByLastName("Подделкин");
    expect(person.phone).toBeNull();
    expect(person.email).toBeNull();
  });

  test("«Обновить»: строк телефона и почты нет ни на экране, ни в ответе", async ({ page }) => {
    const ids = captureActions(page);
    const [person] = await crewByLastName("Беззвонков");
    await db.crewMember.update({ where: { id: person.id }, data: { firstName: "Ваня" } });

    const sniffer = sniff(page);
    await openCrew(page);
    const card = await openCard(page, "Беззвонков");
    await card.getByRole("button", { name: "Обновить из договора" }).click();
    const sync = page.getByRole("dialog").last();
    await expect(sync.locator('[data-sync-field="firstName"]')).toBeVisible();
    await expect(sync.locator('[data-sync-field="phone"]')).toHaveCount(0);
    await expect(sync.locator('[data-sync-field="email"]')).toHaveCount(0);
    actions.preview = ids[ids.length - 1];
    for (const { body } of await sniffer.done()) {
      expect(body).not.toContain("444-55-66");
      expect(body).not.toContain("hidden@e2e.test");
    }
  });
});

test.describe("продюсер: обновить и связать", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("«Обновить»: разница со снимком, ручная правка не отмечена, значения из договора", async ({ page }) => {
    const { id: counterpartyId } = await counterpartyByName(TEMP_COUNTERPARTIES.hidden.name);
    await db.counterparty.update({
      where: { id: counterpartyId },
      data: { contacts: "+7 900 444-55-77, hidden@e2e.test" },
    });

    const ids = captureActions(page);
    await openCrew(page);
    const card = await openCard(page, "Беззвонков");
    await card.getByRole("button", { name: "Обновить из договора" }).click();
    const sync = page.getByRole("dialog").last();

    // Подтянули без контактов: у продюсера они видны как новые данные договора.
    const phone = sync.locator('[data-sync-field="phone"]');
    await expect(phone).toContainText("+7 900 444-55-77");
    await expect(phone).toContainText("изменилось в договоре");
    await expect(phone.getByRole("checkbox")).toBeChecked();

    const name = sync.locator('[data-sync-field="firstName"]');
    await expect(name).toContainText("Иван");
    await expect(name).toContainText("Ваня");
    await expect(name).toContainText("изменено вручную");
    await expect(name.getByRole("checkbox")).not.toBeChecked();

    await sync.getByRole("button", { name: "Применить" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row(page, "Беззвонков")).toContainText("+7 900 444-55-77");
    actions.apply = ids[ids.length - 1];

    const [person] = await crewByLastName("Беззвонков");
    expect(person.phone).toBe("+7 900 444-55-77");
    expect(person.email).toBe("hidden@e2e.test");
    expect(person.firstName).toBe("Ваня");
    expect(person.syncedValues).toMatchObject({ phone: "+7 900 444-55-77", firstName: "Иван" });

    const logs = await db.auditLog.findMany({
      where: { projectId: ctx.projectId, entityType: "crew_member", entityId: person.id, action: "UPDATE" },
      select: { summary: true, changes: true },
    });
    const text = JSON.stringify(logs);
    expect(text).toContain("Обновлён из договора");
    expect(text).toContain("Телефон");
    expect(text).not.toContain("444-55");
    expect(text).not.toContain("hidden@e2e.test");
  });

  test("подделанный запрос подставить значение не может: берётся только договор", async ({ page }) => {
    const [person] = await crewByLastName("Беззвонков");
    const { id: counterpartyId } = await counterpartyByName(TEMP_COUNTERPARTIES.hidden.name);
    await db.counterparty.update({
      where: { id: counterpartyId },
      data: { contacts: "+7 900 444-55-88, hidden@e2e.test" },
    });
    const contract = await contractByNumber(TEMP_COUNTERPARTIES.hidden.number);
    await openCrew(page);
    await callAction(page, actions.apply, [
      ctx.projectId,
      person.id,
      contract.id,
      ["phone", "ещё поле"],
    ]);
    expect((await crewByLastName("Беззвонков"))[0].phone).toBe("+7 900 444-55-77");
    await callAction(page, actions.apply, [ctx.projectId, person.id, contract.id, ["phone"]]);
    expect((await crewByLastName("Беззвонков"))[0].phone).toBe("+7 900 444-55-88");
  });

  test("ООО: связать двух человек; ФИО не берётся; занятый контрагент не предлагается", async ({ page }) => {
    const first = await addManual("Оооов", "Иван");
    await addManual("Кранова", "Анна");

    for (const lastName of ["Оооов", "Кранова"]) {
      await openCrew(page);
      const card = await openCard(page, lastName);
      await card.getByRole("button", { name: "Связать с договором" }).click();
      const link = page.getByRole("dialog").last();
      await link.getByRole("searchbox", { name: "Поиск договора" }).fill(K4.number);
      const option = link.getByTestId("crew-link-option").filter({ hasText: K4.number });
      await expect(option).toContainText(K4.counterparty);
      await option.getByRole("button", { name: "Связать" }).click();
      // Карточка под окном остаётся и показывает новую связь.
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(card).toContainText(K4.number);
      await openCrew(page);
      await expect(row(page, lastName)).toContainText(K4.number);
    }

    await openCrew(page);
    const card = await openCard(page, "Оооов");
    await card.getByRole("button", { name: "Обновить из договора" }).click();
    const sync = page.getByRole("dialog").last();
    await expect(sync).toContainText("берутся только телефон и почта");
    await expect(sync.locator('[data-sync-field="phone"]')).toContainText("+7 495 000-00-01");
    await expect(sync.locator('[data-sync-field="email"]')).toContainText("office@e2e.test");
    await expect(sync.locator('[data-sync-field="lastName"]')).toHaveCount(0);
    await expect(sync.locator('[data-sync-field="firstName"]')).toHaveCount(0);
    await sync.getByRole("button", { name: "Отмена" }).click();

    await card.getByRole("button", { name: "Связать с договором" }).click();
    const link = page.getByRole("dialog").last();
    await expect(link.getByText("Загрузка…")).toHaveCount(0);
    // Уже связанный договор и контрагент, который в команде, в списке не появляются.
    await link.getByRole("searchbox", { name: "Поиск договора" }).fill(K4.number);
    await expect(link.getByTestId("crew-link-option")).toHaveCount(0);
    await link.getByRole("searchbox", { name: "Поиск договора" }).fill(K2.number);
    await expect(link.getByTestId("crew-link-option")).toHaveCount(0);

    const members = await crewByLastName("Оооов");
    expect(members[0].id).toBe(first.id);
    expect(members[0].lastName).toBe("Оооов");
    expect(members[0].source).toBe("CONTRACT");
  });

  test("договор отклонён или удалён: пометка, запись остаётся", async ({ page }) => {
    await addTemp("fate");
    const { number } = TEMP_COUNTERPARTIES.fate;
    await openCrew(page);
    const dialog = await openPull(page);
    const fate = pullRow(dialog, TEMP_COUNTERPARTIES.fate.name);
    await fate.getByLabel("Выбрать").check({ force: true });
    await dialog.getByRole("button", { name: "Добавить выбранных: 1" }).click();
    await expect(row(page, "Судьбин")).toContainText(number);

    const contract = await contractByNumber(number);
    await db.contract.update({ where: { id: contract.id }, data: { statusId: await statusId("REJECTED") } });
    await openCrew(page);
    await expect(row(page, "Судьбин")).toContainText("договор отклонён");
    await expect(row(page, "Судьбин")).toContainText(number);

    await db.contract.delete({ where: { id: contract.id } });
    await openCrew(page);
    await expect(row(page, "Судьбин")).toContainText("договор удалён");
    const [person] = await crewByLastName("Судьбин");
    expect(person.contractLinks).toHaveLength(0);
    expect(person.phone).toBe("+7 900 888-00-33");

    const card = await openCard(page, "Судьбин");
    await expect(card).toContainText("Договор удалён");
    await expect(card.getByRole("button", { name: "Обновить из договора" })).toHaveCount(0);
  });
});

test.describe("пометка без права на договоры", () => {
  test.use({ storageState: storageStatePath("crewonly") });

  test("видно только «из договора»", async ({ page }) => {
    await openCrew(page);
    await expect(row(page, "Судьбин")).toContainText("из договора");
    await expect(row(page, "Судьбин")).not.toContainText("договор удалён");
  });
});
