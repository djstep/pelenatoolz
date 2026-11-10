import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
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
  // Сметы цехов по статьям, собранные тестом: строки → подстатьи → статьи → статьи шаблона.
  const runArticles = { projectId: ctx.projectId, templateArticle: { name: { contains: RUN } } };
  await db.budgetItem.deleteMany({ where: { projectId: ctx.projectId, subarticle: { article: runArticles } } });
  await db.budgetSubarticle.deleteMany({ where: { projectId: ctx.projectId, article: runArticles } });
  await db.budgetArticle.deleteMany({ where: runArticles });
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

// ---------------------------------------------------------------------------
// Шаг 5. Экран сметы цеха по статьям
// ---------------------------------------------------------------------------

test.describe.serial("смета цеха по статьям: экран", () => {
  const transport = `Транспорт смета ${RUN}`;
  const sub = `Спецтранспорт ${RUN}`;
  const camera = `Камерваген ${RUN}`;
  const grim = `Гримваген ${RUN}`;
  const dep = () => ctx.smetaDepartmentId ?? ctx.departmentId;
  const smetaPath = () => projectPath(ctx, `/smeta/${dep()}`);
  let smenyBefore: string | null = null;

  test.beforeAll(async () => {
    const settings = await db.projectBudgetSettings.update({
      where: { projectId: ctx.projectId },
      data: { lastTemplateArticleNumber: { increment: 1 } },
    });
    await db.budgetTemplateArticle.create({
      data: { projectId: ctx.projectId, number: settings.lastTemplateArticleNumber, name: transport, sortOrder: 999 },
    });
    const smeny = await db.projectFinanceVariable.findUniqueOrThrow({
      where: { projectId_key: { projectId: ctx.projectId, key: "SMENY" } },
    });
    smenyBefore = smeny.value?.toString() ?? null;
    await db.projectFinanceVariable.update({ where: { id: smeny.id }, data: { value: 10 } });
    await db.projectFinanceVariable.update({
      where: { projectId_key: { projectId: ctx.projectId, key: "NEDELI" } },
      data: { value: null },
    });
  });

  test.afterAll(async () => {
    await db.projectFinanceVariable.update({
      where: { projectId_key: { projectId: ctx.projectId, key: "SMENY" } },
      data: { value: smenyBefore },
    });
  });

  const line = (page: Page, name: string) => page.locator(`tr[data-budget-line="${name}"]`);
  /** Скрытые колонки строки — под ней, пока строку правят. */
  const lineDetail = (page: Page, name: string) => page.locator(`tr[data-budget-line-detail="${name}"]`);

  test("глава цеха собирает смету: статья, подстатья, строки, множители, налог из формы, итоги; кодов нет", async ({ page }) => {
    await page.goto(smetaPath());
    await expect(page.getByRole("link", { name: "Смета", exact: true })).toHaveAttribute("aria-current", "page");

    // Взять статью из шаблона.
    await page.locator("#take-template-trigger").click();
    await page.getByRole("option", { name: transport }).click();
    await page.getByRole("button", { name: "Взять статью" }).click();
    const article = page.locator(`tr[data-budget-article="${transport}"]`);
    await expect(article).toBeVisible();

    // Подстатья.
    await article.getByRole("button", { name: "+ подстатья" }).click();
    await page.getByPlaceholder("Название подстатьи, Enter — добавить").fill(sub);
    await page.keyboard.press("Enter");
    const subRow = page.locator(`tr[data-budget-subarticle="${sub}"]`);
    await expect(subRow).toBeVisible();

    // Две строки.
    for (const name of [camera, grim]) {
      await subRow.getByRole("button", { name: "+ строка" }).click();
      await page.getByPlaceholder("Наименование строки, Enter — добавить").fill(name);
      await page.keyboard.press("Enter");
      await expect(line(page, name)).toBeVisible();
    }

    // Камерваген: 1 × 15 000 × СМЕНЫ (10), форма ИП — налог 6 % подставляется.
    const cam = line(page, camera);
    await cam.getByLabel("Количество").fill("1");
    await cam.getByLabel("Ставка").fill("15 000");
    await cam.getByRole("button", { name: "Множители" }).click();
    const modal = page.getByRole("dialog", { name: "Множители строки" });
    await expect(modal).toContainText("Можно ввести число, например 0,7 — скидка 30%");
    await modal.locator("#multiplier-0-trigger").click();
    await page.getByRole("option", { name: "СМЕНЫ (10)" }).click();
    await modal.getByRole("button", { name: "Готово" }).click();
    // Форма оплаты и налог % скрыты по умолчанию — при правке строки они под ней.
    await lineDetail(page, camera).locator(`[id$="-form-trigger"]`).click();
    await page.getByRole("option", { name: "ИП", exact: true }).click();
    await expect(lineDetail(page, camera).getByLabel("Налог, %")).toHaveValue("6");
    // Предпросмотр до сохранения: 150 000 + 9 000 = 159 000.
    await expect(cam).toContainText("159 000,00");
    await cam.getByRole("button", { name: "Сохранить" }).click();
    await expect
      .poll(async () => {
        const saved = await db.budgetItem.findFirstOrThrow({ where: { projectId: ctx.projectId, name: camera } });
        return [saved.total.toFixed(2), saved.taxPercent?.toString()];
      })
      .toEqual(["159000.00", "6"]);
    await expect(cam.getByRole("button", { name: /Сохранить|…/ })).toHaveCount(0);

    // Гримваген: × НЕДЕЛИ (не задана) — суммы нет, пометка, в итог не входит.
    const gr = line(page, grim);
    await gr.getByLabel("Количество").fill("1");
    await gr.getByLabel("Ставка").fill("10000");
    await gr.getByRole("button", { name: "Множители" }).click();
    await page.getByRole("dialog", { name: "Множители строки" }).locator("#multiplier-0-trigger").click();
    await page.getByRole("option", { name: "НЕДЕЛИ (не задана)" }).click();
    await page.getByRole("dialog", { name: "Множители строки" }).getByRole("button", { name: "Готово" }).click();
    await gr.getByRole("button", { name: "Сохранить" }).click();
    await expect(gr.getByRole("button", { name: /Сохранить|…/ })).toHaveCount(0);
    await expect(gr.locator("[data-line-problem]")).toHaveText("не задана переменная: НЕДЕЛИ");

    // Итоги: подстатья, статья и смета — 159 000,00; одна строка без суммы.
    await expect(subRow).toContainText("159 000,00");
    await expect(article).toContainText("159 000,00");
    const foot = page.locator("tfoot");
    await expect(foot).toContainText("Итого по смете");
    await expect(foot).toContainText("1 строка без суммы");

    // Кодов статей и префикса цеха на экране нет.
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/[A-Z]{2,6}-\d{2}/);
    const prefix = (await db.department.findUniqueOrThrow({ where: { id: dep() } })).codePrefix;
    expect(text).not.toContain(` ${prefix} `);
  });

  test("свёрнутость подстатьи запоминается; архив строки и «Показать архив»", async ({ page }) => {
    await page.goto(smetaPath());
    const subRow = page.locator(`tr[data-budget-subarticle="${sub}"]`);
    await subRow.getByRole("button", { name: `Свернуть: ${sub}` }).click();
    await expect(line(page, camera)).toHaveCount(0);
    await page.reload();
    await expect(page.locator(`tr[data-budget-subarticle="${sub}"]`)).toBeVisible();
    await expect(line(page, camera)).toHaveCount(0);
    await page.locator(`tr[data-budget-subarticle="${sub}"]`).getByRole("button", { name: `Развернуть: ${sub}` }).click();
    await expect(line(page, camera)).toBeVisible();

    await line(page, grim).getByRole("button", { name: `В архив: ${grim}` }).click();
    await expect(line(page, grim)).toHaveCount(0);
    await expect(page.locator("tfoot")).not.toContainText("без суммы");
    await page.getByLabel("Показать архив").check();
    await expect(line(page, grim)).toBeVisible();
    await line(page, grim).getByRole("button", { name: "Вернуть" }).click();
    await page.getByLabel("Показать архив").uncheck();
    await expect(line(page, grim)).toBeVisible();
  });

  test("несохранённая строка: уход со страницы спрашивает", async ({ page }) => {
    await page.goto(smetaPath());
    await line(page, camera).getByLabel("Ставка").fill("16000");
    await page.getByRole("link", { name: "← Все сметы" }).click();
    const question = page.getByRole("alertdialog");
    await expect(question.getByRole("button", { name: "Не сохранять" })).toBeVisible();
    await question.getByRole("button", { name: "Не сохранять" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, "/smeta")}$`));
    const still = await db.budgetItem.findFirstOrThrow({ where: { projectId: ctx.projectId, name: camera } });
    expect(still.rate?.toString()).toBe("15000");
  });

  test("клавиатура: Enter — сохранить и вниз, Esc — отмена, быстрый ввод новых строк подряд", async ({ page }) => {
    const quick = [`Рация ${RUN}`, `Генератор ${RUN}`, `Плейбек ${RUN}`];
    await page.goto(smetaPath());
    const cam = line(page, camera);
    const gr = line(page, grim);

    // Enter: строка сохраняется, фокус — в ту же колонку следующей строки.
    await cam.getByLabel("Количество").fill("2");
    await page.keyboard.press("Enter");
    await expect(gr.getByLabel("Количество")).toBeFocused();
    await expect
      .poll(async () => (await db.budgetItem.findFirst({ where: { projectId: ctx.projectId, name: camera } }))?.quantity?.toString())
      .toBe("2");

    // Esc — отмена правки строки.
    await page.keyboard.type("7");
    await expect(gr.getByLabel("Количество")).toHaveValue("7");
    await page.keyboard.press("Escape");
    await expect(gr.getByLabel("Количество")).toHaveValue("1");

    // Enter на последней строке — новая строка в той же подстатье; ввод подряд без мыши.
    await page.keyboard.press("Enter");
    const fresh = page.locator("tr[data-budget-new-line]");
    await expect(fresh.getByLabel("Наименование")).toBeFocused();
    for (const [i, name] of quick.entries()) {
      await page.keyboard.type(name);
      await page.keyboard.press("Tab");
      await page.keyboard.type(String(i + 1));
      await page.keyboard.press("Tab");
      await page.keyboard.type("1000");
      await page.keyboard.press("Enter");
    }
    for (const name of quick) await expect(line(page, name)).toBeVisible();
    await expect
      .poll(async () =>
        (
          await db.budgetItem.findMany({
            where: { projectId: ctx.projectId, name: { in: quick } },
            orderBy: { sortOrder: "asc" },
            select: { name: true, quantity: true, rate: true, subarticle: { select: { name: true } } },
          })
        ).map((r) => `${r.name}|${r.quantity}|${r.rate}|${r.subarticle?.name}`),
      )
      .toEqual(quick.map((name, i) => `${name}|${i + 1}|1000|${sub}`));
    // Пустая новая строка закрывается по Esc.
    await expect(fresh.getByLabel("Наименование")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(fresh).toHaveCount(0);
    await db.budgetItem.updateMany({ where: { projectId: ctx.projectId, name: camera }, data: { quantity: 1 } });
  });

  test("список и окно множителей не сохраняют строку раньше времени; уход из строки — сохраняет", async ({ page }) => {
    await page.goto(smetaPath());
    const cam = line(page, camera);
    const rateInDb = async () =>
      (await db.budgetItem.findFirst({ where: { projectId: ctx.projectId, name: camera } }))?.rate?.toString();
    await cam.getByLabel("Ставка").fill("20000");

    // Окно множителей: открыть, выбрать в его списке, закрыть «Отменой».
    await cam.getByRole("button", { name: "Множители" }).click();
    const modal = page.getByRole("dialog", { name: "Множители строки" });
    await modal.locator("#multiplier-1-trigger").click();
    await page.getByRole("option", { name: "СМЕНЫ (10)" }).click();
    await modal.getByRole("button", { name: "Отмена" }).click();
    await expect(modal).toHaveCount(0);
    await expect(cam.getByRole("button", { name: "Множители" })).toBeFocused();
    await page.waitForTimeout(500);
    expect(await rateInDb()).toBe("15000");

    // Выпадающий список формы оплаты (колонка скрыта — список под строкой).
    await lineDetail(page, camera).locator(`[id$="-form-trigger"]`).click();
    await page.getByRole("option", { name: "ИП", exact: true }).click();
    await page.waitForTimeout(500);
    expect(await rateInDb()).toBe("15000");
    await expect(cam.getByLabel("Ставка")).toHaveValue("20000");

    // Щелчок мимо строки — строка сохраняется сама.
    await page.getByRole("heading", { name: /^Смета — / }).click();
    await expect.poll(rateInDb).toBe("20000");
    await expect(lineDetail(page, camera)).toHaveCount(0);

    // Tab из строки в следующую — тоже уход из строки.
    await cam.getByLabel("Ставка").fill("15000");
    await cam.getByRole("button", { name: "Множители" }).focus();
    const grimName = line(page, grim).getByLabel("Наименование");
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await grimName.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(grimName).toBeFocused();
    await expect.poll(rateInDb).toBe("15000");
  });

  test("колонки: по умолчанию пять и без прокрутки в 1280 px, выбор запоминается", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(smetaPath());
    const table = page.getByRole("table", { name: "Смета цеха" });
    await expect(table.locator("thead th")).toHaveText(["Наименование", "Кол-во", "Ставка", "Множители", "Итого", ""]);
    const overflow = await table.evaluate((t) => {
      const wrap = t.parentElement!;
      return { table: wrap.scrollWidth - wrap.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(overflow).toEqual({ table: 0, page: 0 });

    // Скрытые колонки — под строкой, пока её правят.
    await line(page, camera).getByLabel("Количество").click();
    const detail = lineDetail(page, camera);
    await expect(detail.getByLabel("Единица")).toBeVisible();
    await expect(detail.getByLabel("Налог, %")).toHaveValue("6");
    await expect(detail).toContainText("Сумма");

    // Включить «Сумму» и «Налог» — запоминается после перезагрузки.
    await page.getByRole("button", { name: "Колонки" }).click();
    const menu = page.getByRole("dialog").filter({ hasText: "Скрытые колонки видны при правке строки" });
    await menu.getByLabel("Сумма", { exact: true }).check();
    await menu.getByLabel("Налог", { exact: true }).check();
    await expect(menu.getByLabel("Итого", { exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(table.locator("thead th")).toHaveText(["Наименование", "Кол-во", "Ставка", "Множители", "Сумма", "Налог", "Итого", ""]);
    await expect(line(page, camera)).toContainText("150 000,00");
    await page.getByRole("button", { name: "Колонки" }).click();
    await page.getByRole("button", { name: "Как было по умолчанию" }).click();
    await expect(table.locator("thead th")).toHaveCount(6);
  });

  test("импорт из Excel: наша выгрузка → правка в файле → строки по «Коду» обновляются, новые добавляются; ошибка — ничего не загружено", async ({
    page,
  }, testInfo) => {
    const tonvagen = `Тонваген ${RUN}`;
    await page.goto(smetaPath());
    // Выгрузка: окно колонок, «Код» — по умолчанию.
    await page.getByRole("button", { name: "Экспорт Excel" }).click();
    const exportDialog = page.getByRole("dialog", { name: "Экспорт сметы в Excel" });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportDialog.getByRole("button", { name: "Экспортировать Excel" }).click(),
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(readFileSync((await download.path())!) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
    const sheet = book.getWorksheet("Смета")!;
    let cameraRow = 0;
    sheet.eachRow((row, n) => {
      if (row.getCell(2).value === camera) cameraRow = n;
    });
    expect(cameraRow).toBeGreaterThan(0);
    const cameraCode = String(sheet.getRow(cameraRow).getCell(1).value);
    sheet.getRow(cameraRow).getCell(6).value = 16000;
    sheet.addRow(["", tonvagen, "", "смена", 1, 5000, "", "", 0]);
    const good = testInfo.outputPath("import-good.xlsx");
    await book.xlsx.writeFile(good);
    // Тот же файл с чужим кодом в новой строке — ошибка строки.
    const last = sheet.lastRow!;
    last.getCell(1).value = "ZZ-99.99.99";
    const bad = testInfo.outputPath("import-bad.xlsx");
    await book.xlsx.writeFile(bad);

    const linesBefore = await db.budgetItem.count({ where: { projectId: ctx.projectId, subarticle: { name: sub } } });
    const openImport = async (file: string) => {
      await page.getByRole("button", { name: "Импорт из Excel" }).click();
      const dialog = page.getByRole("dialog", { name: "Импорт из Excel в смету" });
      await dialog.locator("#items-import-file").setInputFiles(file);
      await expect(dialog.getByText(/Предпросмотр: строк к загрузке/)).toBeVisible();
      await dialog.locator("#items-import-target-trigger").click();
      await page.getByRole("option", { name: `${transport} / ${sub}` }).click();
      return dialog;
    };

    // Ошибка строки: ничего не загружено, номер строки листа — в сообщении.
    const failing = await openImport(bad);
    await failing.getByRole("button", { name: /^Загрузить/ }).click();
    const result = failing.locator("[data-import-result]");
    await expect(result).toContainText("Ничего не загружено");
    await expect(result).toContainText(`строка ${last.number}: Код ZZ-99.99.99 не найден в этой смете`);
    expect(await db.budgetItem.count({ where: { projectId: ctx.projectId, subarticle: { name: sub } } })).toBe(linesBefore);
    await failing.getByRole("button", { name: "Отмена" }).or(failing.getByRole("button", { name: "Закрыть" })).first().click();

    // Проверка и загрузка: одна строка обновлена по коду, одна добавлена, остальные без изменений.
    const dialog = await openImport(good);
    // Строки статьи, подстатьи и «Итого» из выгрузки пропускаются — и это видно, не молча.
    await expect(dialog.locator("[data-import-skipped]")).toContainText("Пропущено строк");
    await dialog.getByRole("button", { name: "Проверить" }).click();
    await expect(dialog.locator("[data-import-result]")).toContainText("будет добавлено — 1, обновлено — 1");
    await dialog.getByRole("button", { name: /^Загрузить/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(line(page, tonvagen)).toBeVisible();
    const cam = await db.budgetItem.findMany({ where: { projectId: ctx.projectId, name: camera } });
    expect(cam.map((c) => [c.code, c.rate?.toString()])).toEqual([[cameraCode, "16000"]]);
    const added = await db.budgetItem.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: tonvagen },
      select: { rate: true, quantity: true, subarticle: { select: { name: true } } },
    });
    expect([added.rate?.toString(), added.quantity?.toString(), added.subarticle?.name]).toEqual(["5000", "1", sub]);
    const journal = await db.auditLog.findFirst({
      where: { projectId: ctx.projectId, summary: { contains: "импорт из Excel" } },
      orderBy: { createdAt: "desc" },
      select: { summary: true },
    });
    expect(journal?.summary).toContain("добавлено строк — 1, обновлено — 1");
    await db.budgetItem.updateMany({ where: { projectId: ctx.projectId, name: camera }, data: { rate: 15000 } });
  });

  test("вкладка «Черновики»: листы Excel без основного листа сметы", async ({ page }) => {
    await page.goto(smetaPath());
    await page.getByRole("link", { name: "Черновики" }).click();
    await expect(page).toHaveURL(/\?tab=drafts$/);
    await expect(page.getByText("Листы-черновики: расчёты и заметки")).toBeVisible();
    await page.waitForSelector(".univer-smeta-host canvas", { timeout: 90_000 });
    const main = await db.budget.findFirstOrThrow({
      where: { departmentId: dep() },
      select: { mainSheet: { select: { name: true } } },
    });
    if (main.mainSheet) {
      await expect(page.getByRole("button", { name: main.mainSheet.name, exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: "Взять статью" })).toHaveCount(0);
  });

  test("глава цеха без финансов: переменные и формы оплаты видны только для чтения", async ({ browser }) => {
    const nofin = await db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, user: { email: E2E_ROLES.nofin.email } },
      select: { id: true },
    });
    const head = await db.departmentHead.create({ data: { departmentId: dep(), membershipId: nofin.id } });
    const { context, page } = await openAs(browser, "nofin");
    try {
      await page.goto(smetaPath());
      const reference = page.locator("[data-budget-reference]");
      await reference.locator("summary").click();
      await expect(reference.locator('[data-budget-variable="СМЕНЫ"]')).toContainText("10");
      await expect(reference.locator('[data-budget-variable="НЕДЕЛИ"]')).toContainText("не задана");
      await expect(reference).toContainText("Самозанятый");
      await expect(reference.getByRole("link", { name: "настройках финансов" })).toHaveCount(0);
      // Денег не видно: у главы нет права на финансы, но сумм своей сметы он не лишён — проверяем
      // только, что смета другого цеха ему не видна.
      if (ctx.departmentId !== dep()) {
        const res = await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
        expect(res?.status()).toBe(404);
      }
    } finally {
      await context.close();
      await db.departmentHead.delete({ where: { id: head.id } });
    }
  });
});
