import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна «Смета по статьям».
 * Шаг 2: справочники сметы есть в проекте после миграции, новые переменные пустые,
 * открытие настроек финансов в базу ничего не пишет.
 * Шаг 3: шаблон статей (продюсер), справочники в настройках финансов, права (ответ сервера),
 * налог по умолчанию в новом договоре — из формы оплаты по типу контрагента.
 */

const ctx = e2eContext();
const db = e2eDb();
test.use({ storageState: storageStatePath("producer") });

/** Метка прогона: всё, что тест создаёт, содержит её — потом удаляется. */
const RUN = Date.now().toString(36);
/** Id серверных действий, пойманные у продюсера, — для подделанных запросов других ролей. */
const actionIds: Record<string, string> = {};

test.afterAll(async () => {
  await db.budgetTemplateArticle.deleteMany({ where: { projectId: ctx.projectId, name: { contains: RUN } } });
  await db.projectExpenseType.deleteMany({ where: { projectId: ctx.projectId, name: { contains: RUN } } });
  await db.counterparty.deleteMany({ where: { projectId: ctx.projectId, name: { contains: RUN } } });
  await db.$disconnect();
});

/** Id действия из следующего запроса страницы с заголовком `next-action`. */
async function nextActionId(page: Page, trigger: () => Promise<void>) {
  const request = page.waitForRequest((r) => Boolean(r.headers()["next-action"]));
  await trigger();
  return (await request).headers()["next-action"]!;
}

/** Вызов действия напрямую, мимо экрана: как подделанный запрос. */
async function callAction(page: Page, path: string, actionId: string, args: unknown[]) {
  const res = await page.request.post(path, {
    headers: {
      "next-action": actionId,
      accept: "text/x-component",
      "content-type": "text/plain;charset=UTF-8",
      origin: new URL(page.url()).origin,
    },
    data: JSON.stringify(args),
  });
  return { status: res.status(), body: await res.text() };
}

async function openAs(browser: Browser, role: keyof typeof E2E_ROLES) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

/** Снимок справочников сметы проекта: число строк и последнее изменение. */
async function directoriesSnapshot(projectId: string) {
  const where = { projectId };
  const [settings, expenseTypes, paymentForms, mappings, variables] = await Promise.all([
    db.projectBudgetSettings.findUnique({ where, select: { updatedAt: true } }),
    db.projectExpenseType.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    db.projectPaymentForm.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    db.projectCounterpartyPaymentForm.aggregate({ where, _count: true, _max: { updatedAt: true } }),
    db.projectFinanceVariable.aggregate({ where, _count: true, _max: { updatedAt: true } }),
  ]);
  return { settings, expenseTypes, paymentForms, mappings, variables };
}

test("справочники сметы в проекте: типы расходов, формы оплаты, сопоставление, переменные", async () => {
  const project = await db.project.findUniqueOrThrow({
    where: { id: ctx.projectId },
    select: {
      budgetSettings: { select: { reservePercent: true, agencyPercent: true } },
      expenseTypes: { select: { name: true }, orderBy: { sortOrder: "asc" } },
      paymentForms: { select: { key: true, defaultTaxPercent: true }, orderBy: { sortOrder: "asc" } },
      counterpartyPaymentForms: { select: { counterpartyType: true, paymentForm: { select: { key: true } } } },
      financeVariables: { where: { isSystem: true }, select: { key: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  expect(project.budgetSettings).not.toBeNull();
  expect(project.expenseTypes.map((t) => t.name)).toEqual([
    "Гонорар / ФОТ",
    "Аренда техники",
    "Покупка / расходники",
    "Транспорт",
    "Услуги подрядчика",
    "Площадки",
    "Питание",
    "Проживание",
    "Суточные",
    "Прочее",
  ]);
  expect(project.paymentForms.map((f) => [f.key, f.defaultTaxPercent == null ? null : Number(f.defaultTaxPercent)])).toEqual([
    ["SELF_EMPLOYED", 6],
    ["IP", 6],
    ["GPH", null],
    ["CASH", null],
    ["LEGAL_ENTITY", null],
  ]);
  expect(
    Object.fromEntries(project.counterpartyPaymentForms.map((m) => [m.counterpartyType, m.paymentForm.key])),
  ).toEqual({ IP: "IP", SELF_EMPLOYED: "SELF_EMPLOYED" });
  expect(project.financeVariables.map((v) => v.key)).toEqual(["SMENY", "SERII", "DNI_PODGOTOVKI", "NEDELI"]);
});

test("настройки финансов: новые переменные видны и пустые; открытие страницы ничего не пишет", async ({ page }) => {
  await db.projectFinanceVariable.updateMany({
    where: { projectId: ctx.projectId, key: { in: ["DNI_PODGOTOVKI", "NEDELI"] } },
    data: { value: null },
  });
  const before = await directoriesSnapshot(ctx.projectId);

  await page.goto(projectPath(ctx, "/finance/settings"));
  for (const label of ["ДНИ ПОДГОТОВКИ", "НЕДЕЛИ"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator("#val-DNI_PODGOTOVKI")).toHaveValue("");
  await expect(page.locator("#val-NEDELI")).toHaveValue("");
  await page.waitForLoadState("networkidle");

  expect(await directoriesSnapshot(ctx.projectId)).toEqual(before);
});

// ---------------------------------------------------------------------------
// Шаг 3. Шаблон статей
// ---------------------------------------------------------------------------

test.describe.serial("шаблон статей", () => {
  const transport = `Транспорт ${RUN}`;
  const camera = `Камера ${RUN}`;
  const cameraRenamed = `Операторский цех ${RUN}`;
  const TEMPLATE_PATH = projectPath(ctx, "/smeta/template");

  const rowOf = (page: Page, name: string) => page.locator(`li[data-template-article="${name}"]`);
  const activeNames = (page: Page) =>
    page
      .getByRole("list", { name: "Статьи шаблона" })
      .locator("li")
      .evaluateAll((items) =>
        items.map((li) => li.getAttribute("data-template-article")).filter((n): n is string => Boolean(n)),
      );

  test("продюсер: добавить, переименовать, переставить, в архив и обратно; номеров и кодов на экране нет", async ({ page }) => {
    await page.goto(projectPath(ctx, "/smeta"));
    await page.getByRole("link", { name: "Шаблон статей" }).click();
    await expect(page).toHaveURL(new RegExp(`${TEMPLATE_PATH}$`));

    for (const name of [transport, camera]) {
      await page.locator("#template-article-name").fill(name);
      await page.getByRole("button", { name: "Добавить статью" }).click();
      await expect(rowOf(page, name)).toBeVisible();
    }
    const created = await db.budgetTemplateArticle.findMany({
      where: { projectId: ctx.projectId, name: { in: [transport, camera] } },
      select: { name: true, number: true },
      orderBy: { number: "asc" },
    });
    expect(created.map((a) => a.name)).toEqual([transport, camera]);
    expect(created[1]!.number).toBe(created[0]!.number + 1);

    // Переименовать.
    await rowOf(page, camera).getByRole("button", { name: "Переименовать" }).click();
    const dialog = page.getByRole("dialog", { name: "Переименовать статью" });
    await dialog.locator("#template-rename-name").fill(cameraRenamed);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(rowOf(page, cameraRenamed)).toBeVisible();

    // Переставить: «Операторский цех» выше «Транспорта».
    const before = await activeNames(page);
    await rowOf(page, cameraRenamed).getByRole("button", { name: `Выше: ${cameraRenamed}` }).click();
    await expect.poll(() => activeNames(page)).not.toEqual(before);
    const after = await activeNames(page);
    expect(after.indexOf(cameraRenamed)).toBe(after.indexOf(transport) - 1);

    // В архив и обратно; номер у статьи тот же.
    actionIds.archiveTemplate = await nextActionId(page, () =>
      rowOf(page, transport).getByRole("button", { name: "В архив" }).click(),
    );
    const archive = page.getByRole("list", { name: "Архив статей" });
    const archivedRow = archive.locator(`li[data-template-article="${transport}"]`);
    await expect(archivedRow).toBeVisible();
    await archivedRow.getByRole("button", { name: "Вернуть" }).click();
    await expect(
      page.getByRole("list", { name: "Статьи шаблона" }).locator(`li[data-template-article="${transport}"]`),
    ).toBeVisible();
    const transportRow = await db.budgetTemplateArticle.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: transport },
      select: { number: true, archivedAt: true },
    });
    expect(transportRow.number).toBe(created[0]!.number);
    expect(transportRow.archivedAt).toBeNull();

    // Кодов статей на экране нет.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[A-Z]{2,6}-\d{2}/);

    const log = await db.auditLog.count({
      where: { projectId: ctx.projectId, entityType: "budget_template_article", summary: { contains: RUN } },
    });
    expect(log).toBeGreaterThanOrEqual(6);
  });

  test("глава цеха (не продюсер): видит шаблон без кнопок, подделанный запрос — отказ", async ({ browser }) => {
    test.skip(!actionIds.archiveTemplate, "нет id действия из теста продюсера");
    const nofin = await db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, user: { email: E2E_ROLES.nofin.email } },
      select: { id: true },
    });
    const head = await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: nofin.id } });
    const { context, page } = await openAs(browser, "nofin");
    try {
      await page.goto(TEMPLATE_PATH);
      await expect(rowOf(page, transport)).toBeVisible();
      await expect(page.getByRole("button", { name: "Добавить статью" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "В архив" })).toHaveCount(0);

      const article = await db.budgetTemplateArticle.findFirstOrThrow({
        where: { projectId: ctx.projectId, name: transport },
        select: { id: true },
      });
      const forged = await callAction(page, TEMPLATE_PATH, actionIds.archiveTemplate!, [ctx.projectId, article.id, true]);
      expect(forged.body).toContain("Шаблон статей ведёт продюсер");
      const still = await db.budgetTemplateArticle.findUniqueOrThrow({
        where: { id: article.id },
        select: { archivedAt: true },
      });
      expect(still.archivedAt).toBeNull();
    } finally {
      await context.close();
      await db.departmentHead.delete({ where: { id: head.id } });
    }
  });
});

// ---------------------------------------------------------------------------
// Шаг 3. Справочники в «Финансы → Настройки»
// ---------------------------------------------------------------------------

test.describe.serial("справочники сметы в настройках финансов", () => {
  const SETTINGS_PATH = projectPath(ctx, "/finance/settings");
  const section = (page: Page, title: string) =>
    page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });

  test("продюсер: резерв и агентские, процент формы оплаты, сопоставление, тип расхода, пустая переменная — с журналом", async ({ page }) => {
    const formId = async (key: string) =>
      (await db.projectPaymentForm.findFirstOrThrow({ where: { projectId: ctx.projectId, key }, select: { id: true } })).id;
    const ip = await formId("IP");
    const selfEmployed = await formId("SELF_EMPLOYED");
    const gph = await formId("GPH");
    await db.projectBudgetSettings.update({
      where: { projectId: ctx.projectId },
      data: { reservePercent: 0, agencyPercent: 0 },
    });
    try {
      await page.goto(SETTINGS_PATH);

      // Резерв и агентские.
      const percents = section(page, "Резерв и агентские");
      await percents.locator("#reservePercent").fill("5");
      await percents.locator("#agencyPercent").fill("10,5");
      await percents.getByRole("button", { name: "Сохранить" }).click();
      await expect
        .poll(async () => {
          const s = await db.projectBudgetSettings.findUniqueOrThrow({ where: { projectId: ctx.projectId } });
          return [Number(s.reservePercent), Number(s.agencyPercent)];
        })
        .toEqual([5, 10.5]);
      const percentLog = await db.auditLog.findFirst({
        where: { projectId: ctx.projectId, entityType: "budget_settings" },
        orderBy: { createdAt: "desc" },
        select: { summary: true },
      });
      expect(percentLog?.summary).toContain("резерв 0 % → 5 %");
      expect(percentLog?.summary).toContain("агентские 0 % → 10,5 %");

      // Процент формы оплаты «ИП» 6 → 7; у ГПХ процента нет.
      const forms = section(page, "Формы оплаты");
      await forms.locator('tr[data-payment-form="ИП"]').getByRole("button", { name: "Изменить" }).click();
      const dialog = page.getByRole("dialog", { name: "Форма оплаты" });
      await dialog.locator("#payment-form-percent").fill("7");
      await dialog.getByRole("button", { name: "Сохранить" }).click();
      await expect(forms.locator('tr[data-payment-form="ИП"]')).toContainText("7 %");
      await expect(forms.locator('tr[data-payment-form="ГПХ"]')).toContainText("—");

      // Физлицо → Самозанятый.
      const mapping = section(page, "Налог в договоре и акте");
      await mapping.locator("#map-INDIVIDUAL").selectOption(selfEmployed);
      await mapping.getByRole("button", { name: "Сохранить" }).click();
      await expect
        .poll(
          async () =>
            (
              await db.projectCounterpartyPaymentForm.findUnique({
                where: { projectId_counterpartyType: { projectId: ctx.projectId, counterpartyType: "INDIVIDUAL" } },
              })
            )?.paymentFormId,
        )
        .toBe(selfEmployed);

      // Свой тип расхода и архив.
      const types = section(page, "Типы расходов");
      const typeName = `Тип ${RUN}`;
      await types.locator("#expense-type-name").fill(typeName);
      await types.getByRole("button", { name: "Добавить" }).click();
      const typeRow = types.locator(`li[data-expense-type="${typeName}"]`);
      await expect(typeRow).toBeVisible();
      await typeRow.getByRole("button", { name: "В архив" }).click();
      await expect(typeRow).toContainText("в архиве");

      // Переменная ДНИ ПОДГОТОВКИ: 10, затем пусто — не задано (null), а не 0.
      const dniValue = () =>
        db.projectFinanceVariable
          .findUniqueOrThrow({ where: { projectId_key: { projectId: ctx.projectId, key: "DNI_PODGOTOVKI" } } })
          .then((v) => (v.value == null ? null : Number(v.value)));
      const saveDni = async (value: string) => {
        const input = page.locator("#val-DNI_PODGOTOVKI");
        await input.fill(value);
        await page.locator("form", { has: input }).getByRole("button", { name: "Сохранить" }).click();
      };
      await saveDni("10");
      await expect.poll(dniValue).toBe(10);
      await page.reload();
      await saveDni("");
      await expect.poll(dniValue).toBeNull();

      // Для подделанного запроса другой роли: id действия «в архив» формы оплаты.
      await page.reload();
      const gphRow = section(page, "Формы оплаты").locator('tr[data-payment-form="ГПХ"]');
      actionIds.archivePaymentForm = await nextActionId(page, () =>
        gphRow.getByRole("button", { name: "В архив" }).click(),
      );
      await expect(gphRow).toContainText("в архиве");
    } finally {
      await db.projectBudgetSettings.update({
        where: { projectId: ctx.projectId },
        data: { reservePercent: 0, agencyPercent: 0 },
      });
      await db.projectPaymentForm.update({ where: { id: ip }, data: { defaultTaxPercent: 6 } });
      await db.projectPaymentForm.update({ where: { id: gph }, data: { archivedAt: null } });
      // Физлицо по умолчанию не сопоставлено.
      await db.projectCounterpartyPaymentForm.deleteMany({
        where: { projectId: ctx.projectId, counterpartyType: "INDIVIDUAL" },
      });
    }
  });

  test("без права на финансы: настроек не видно, подделанный запрос — отказ, данные не меняются", async ({ browser }) => {
    test.skip(!actionIds.archivePaymentForm, "нет id действия из теста продюсера");
    const { context, page } = await openAs(browser, "nofin");
    try {
      await page.goto(SETTINGS_PATH);
      await expect(page.getByText("Нет доступа к финансам")).toBeVisible();
      const form = await db.projectPaymentForm.findFirstOrThrow({
        where: { projectId: ctx.projectId, key: "SELF_EMPLOYED" },
        select: { id: true },
      });
      const forged = await callAction(page, SETTINGS_PATH, actionIds.archivePaymentForm!, [ctx.projectId, form.id, true]);
      expect(forged.body).toContain("Справочники сметы меняют продюсер");
      const still = await db.projectPaymentForm.findUniqueOrThrow({ where: { id: form.id }, select: { archivedAt: true } });
      expect(still.archivedAt).toBeNull();
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Шаг 3. Налог по умолчанию в новом договоре
// ---------------------------------------------------------------------------

test("новый договор: налог по умолчанию из формы оплаты по типу контрагента", async ({ page }) => {
  const names = { ip: `ИП Налогов ${RUN}`, person: `Физлицо Налогов ${RUN}`, company: `ООО Налог ${RUN}` };
  await db.counterparty.createMany({
    data: [
      { projectId: ctx.projectId, name: names.ip, type: "IP" },
      { projectId: ctx.projectId, name: names.person, type: "INDIVIDUAL" },
      { projectId: ctx.projectId, name: names.company, type: "LEGAL_ENTITY" },
    ],
  });
  // Юрлицо на время теста сопоставлено форме без процента (ГПХ); по умолчанию — не сопоставлено.
  const gph = await db.projectPaymentForm.findFirstOrThrow({
    where: { projectId: ctx.projectId, key: "GPH" },
    select: { id: true },
  });
  await db.projectCounterpartyPaymentForm.create({
    data: { projectId: ctx.projectId, counterpartyType: "LEGAL_ENTITY", paymentFormId: gph.id },
  });
  try {
    await page.goto(projectPath(ctx, "/counterparties/contracts"));
    await page.getByRole("button", { name: "Добавить договор" }).click();
    const dialog = page.getByRole("dialog", { name: "Новый договор" });
    const tax = dialog.getByRole("checkbox", { name: "С налогом" });
    await expect(tax).not.toBeChecked();

    // Выбор контрагента: блок с полем counterpartyId.
    const picker = dialog.locator("div.relative", { has: page.locator('input[name="counterpartyId"]') });
    const pickCounterparty = async (name: string) => {
      await picker.locator("button.glass-select-trigger").click();
      await dialog.getByPlaceholder("Поиск…").fill(name);
      await dialog.getByRole("button", { name }).click();
    };

    // ИП → форма «ИП», 6 %. Id действия — для подделанного запроса роли без финансов.
    actionIds.taxDefault = await nextActionId(page, () => pickCounterparty(names.ip));
    await expect(tax).toBeChecked();
    await expect(dialog.locator("#vatRate")).toHaveValue("6");

    // Физлицо (ГПХ) не сопоставлено: налог уже в стоимости, по умолчанию выключен.
    await pickCounterparty(names.person);
    await expect(tax).not.toBeChecked();

    // Форма без процента: налог включён, ставку вводят руками.
    await pickCounterparty(names.company);
    await expect(tax).toBeChecked();
    await expect(dialog.locator("#vatRate")).toHaveValue("");
    await expect(dialog).not.toContainText("НДС");
  } finally {
    await db.projectCounterpartyPaymentForm.deleteMany({
      where: { projectId: ctx.projectId, counterpartyType: "LEGAL_ENTITY" },
    });
  }
});

test("налог по умолчанию без права на финансы: сервер процент не отдаёт", async ({ browser }) => {
  test.skip(!actionIds.taxDefault, "нет id действия из теста продюсера");
  const counterparty = await db.counterparty.findFirstOrThrow({
    where: { projectId: ctx.projectId, type: "IP" },
    select: { id: true },
  });
  const { context, page } = await openAs(browser, "nofin");
  try {
    const path = projectPath(ctx, "/counterparties/contracts");
    await page.goto(path);
    const forged = await callAction(page, path, actionIds.taxDefault!, [ctx.projectId, counterparty.id]);
    expect(forged.body).toContain("Недостаточно прав");
    expect(forged.body).not.toContain("rate");
  } finally {
    await context.close();
  }
});
