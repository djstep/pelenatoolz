import { expect, test, type Browser, type Page } from "@playwright/test";
import { BudgetStatus, Prisma, ProjectType } from "@prisma/client";
import { E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, storageStatePath } from "./helpers/session";

/**
 * Волна «Смета по статьям», шаг 7: сводная продюсера по цехам и по статьям шаблона (раскрытие до
 * строк, итоги, резерв и агентские), план/факт от строк новой сметы и «Утвердить пересчёт» после
 * смены переменных. Версии удаляются только вместе с проектом — тест работает на своём временном
 * проекте и в конце удаляет его.
 */

const ctx = e2eContext();
const db = e2eDb();
const RUN = Date.now().toString(36);

type Dept = { key: "a" | "b" | "c"; id: string; name: string; budgetId: string };
const state = {
  projectId: "",
  smenyId: "",
  depts: {} as Record<Dept["key"], Dept>,
  bLineId: "",
  singleRecalcId: null as string | null,
  allRecalcId: null as string | null,
};

const DEPT_NAMES = { a: `Транспортный ${RUN}`, b: `Операторский ${RUN}`, c: `Звуковой ${RUN}` };

async function openAs(browser: Browser, role: keyof typeof E2E_ROLES) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

async function nextActionId(page: Page, trigger: () => Promise<void>) {
  const request = page.waitForRequest((r) => Boolean(r.headers()["next-action"]));
  await trigger();
  return (await request).headers()["next-action"]!;
}

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

const base = () => `/ru/projects/${state.projectId}/smeta`;
const status = async (key: Dept["key"]) =>
  (await db.budget.findUniqueOrThrow({ where: { id: state.depts[key].budgetId }, select: { status: true } })).status;

/** Глава (здесь — продюсер, он же глава всех цехов) отправляет, продюсер утверждает. */
async function submitAndApprove(page: Page, key: Dept["key"]) {
  const path = `${base()}/${state.depts[key].id}`;
  await page.goto(path);
  await page.getByRole("button", { name: "Отправить на утверждение" }).click();
  await page.getByRole("dialog", { name: "Отправить на утверждение" }).getByRole("button", { name: "Отправить" }).click();
  await expect.poll(() => status(key)).toBe(BudgetStatus.SUBMITTED);
  await page.goto(`${path}/review`);
  await page.getByRole("button", { name: "Утвердить" }).click();
  await page.getByRole("dialog", { name: /Создать версию/ }).getByRole("button", { name: "Утвердить" }).click();
  await expect.poll(() => status(key)).toBe(BudgetStatus.APPROVED);
}

test.describe.serial("смета по статьям: сводная, план/факт, пересчёт по переменным", () => {
  test.beforeAll(async () => {
    const [producer, nofin] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } }),
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.nofin.email }, select: { id: true } }),
    ]);
    const members = await db.projectMembership.findMany({
      where: { projectId: ctx.projectId, userId: { in: [producer.id, nofin.id] } },
      select: { userId: true, role: { select: { name: true, note: true, isSystem: true, permissions: true } } },
    });
    const project = await db.project.create({
      data: { name: `E2E сводная ${RUN}`, type: ProjectType.FEATURE, createdById: producer.id, ownerUserId: producer.id },
      select: { id: true },
    });
    state.projectId = project.id;
    let producerMembership = "";
    for (const m of members) {
      const role = await db.projectRoleDefinition.create({
        data: { projectId: project.id, name: m.role.name, note: m.role.note, isSystem: m.role.isSystem, permissions: m.role.permissions as Prisma.InputJsonValue },
        select: { id: true },
      });
      const membership = await db.projectMembership.create({
        data: { projectId: project.id, userId: m.userId, roleId: role.id },
        select: { id: true },
      });
      if (m.userId === producer.id) producerMembership = membership.id;
    }
    await db.projectBudgetSettings.create({ data: { projectId: project.id, reservePercent: 10, agencyPercent: 5 } });
    const smeny = await db.projectFinanceVariable.create({
      data: { projectId: project.id, key: "SMENY", label: "СМЕНЫ", value: 10, isSystem: true, sortOrder: 1 },
      select: { id: true },
    });
    state.smenyId = smeny.id;

    const template = async (number: number, name: string) =>
      db.budgetTemplateArticle.create({ data: { projectId: project.id, number, name, sortOrder: number }, select: { id: true } });
    const transport = await template(1, "Транспорт");
    const camera = await template(2, "Камера");
    const sound = await template(3, "Звук");

    const prefixes = { a: "TR", b: "OP", c: "ZV" } as const;
    for (const key of ["a", "b", "c"] as const) {
      const department = await db.department.create({
        data: { projectId: project.id, name: DEPT_NAMES[key], codePrefix: prefixes[key], sortOrder: { a: 1, b: 2, c: 3 }[key] },
        select: { id: true },
      });
      // Продюсер — глава всех трёх цехов: сам отправляет и утверждает.
      await db.departmentHead.create({ data: { departmentId: department.id, membershipId: producerMembership } });
      const budget = await db.budget.create({
        data: { projectId: project.id, departmentId: department.id, createdById: producer.id },
        select: { id: true },
      });
      state.depts[key] = { key, id: department.id, name: DEPT_NAMES[key], budgetId: budget.id };
    }

    let lineNo = 0;
    const addLine = async (
      key: Dept["key"],
      templateId: string,
      sub: string,
      line: { name: string; quantity: number; rate: number; taxPercent: number; smeny: boolean; total: number },
    ) => {
      const dept = state.depts[key];
      const article = await db.budgetArticle.create({
        data: { projectId: project.id, budgetId: dept.budgetId, templateArticleId: templateId, lastSubarticleNumber: 1 },
        select: { id: true },
      });
      const subarticle = await db.budgetSubarticle.create({
        data: { projectId: project.id, articleId: article.id, number: 1, name: sub, lastLineNumber: 1 },
        select: { id: true },
      });
      lineNo++;
      const item = await db.budgetItem.create({
        data: {
          projectId: project.id,
          departmentId: dept.id,
          subarticleId: subarticle.id,
          number: 1,
          code: `${prefixes[key]}-0${lineNo}.01.01`,
          name: line.name,
          quantity: line.quantity,
          rate: line.rate,
          taxPercent: line.taxPercent,
          multiplier1VariableId: line.smeny ? state.smenyId : null,
          amount: line.total / (1 + line.taxPercent / 100),
          tax: line.total - line.total / (1 + line.taxPercent / 100),
          total: line.total,
        },
        select: { id: true },
      });
      return item.id;
    };
    // A: 1 × 15 000 × СМЕНЫ(10) + 6% = 159 000.
    await addLine("a", transport.id, "Спецтранспорт", { name: `Камерваген ${RUN}`, quantity: 1, rate: 15000, taxPercent: 6, smeny: true, total: 159000 });
    // B: Транспорт 5 000 (без переменной) и Камера 2 × 3 000 × СМЕНЫ(10) = 60 000.
    state.bLineId = await addLine("b", transport.id, "Перевозка", { name: `Тонваген ${RUN}`, quantity: 1, rate: 5000, taxPercent: 0, smeny: false, total: 5000 });
    await addLine("b", camera.id, "Оптика", { name: `Объектив ${RUN}`, quantity: 2, rate: 3000, taxPercent: 0, smeny: true, total: 60000 });
    // C: 1 × 1 000 × СМЕНЫ(10) = 10 000.
    await addLine("c", sound.id, "Запись", { name: `Рекордер ${RUN}`, quantity: 1, rate: 1000, taxPercent: 0, smeny: true, total: 10000 });
  });

  test.afterAll(async () => {
    if (state.projectId) await db.project.delete({ where: { id: state.projectId } });
    await db.$disconnect();
  });

  test("сводная по черновикам: по цехам и по статьям, раскрытие до строк, резерв и агентские", async ({ browser }) => {
    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(`${base()}/summary?drafts=1`);
      await expect(page.locator(`tr[data-summary-department="${DEPT_NAMES.a}"]`)).toContainText("159 000,00");
      await expect(page.locator(`tr[data-summary-department="${DEPT_NAMES.b}"]`)).toContainText("65 000,00");
      // 234 000 по цехам; резерв 10% = 23 400; агентские 5% = 11 700; итого 269 100.
      await expect(page.locator("[data-summary-subtotal]")).toContainText("234 000,00");
      await expect(page.locator("[data-summary-reserve]")).toContainText("23 400,00");
      await expect(page.locator("[data-summary-agency]")).toContainText("11 700,00");
      await expect(page.locator("[data-summary-total]")).toContainText("269 100,00");

      // По статьям: «Транспорт» двух цехов складывается (159 000 + 5 000), раскрытие до строк.
      await page.getByRole("link", { name: "По статьям" }).click();
      const transport = page.locator('tr[data-summary-article="Транспорт"]');
      await expect(transport).toContainText("164 000,00");
      await expect(transport).toContainText("2 цеха");
      await transport.getByRole("button", { name: "Развернуть: Транспорт" }).click();
      await page.getByRole("button", { name: `Развернуть: ${DEPT_NAMES.a}` }).click();
      await page.getByRole("button", { name: "Развернуть: Спецтранспорт" }).click();
      await expect(page.locator(`tr[data-summary-line="Камерваген ${RUN}"]`)).toContainText("× СМЕНЫ (10)");
      // Раскрытие запоминается.
      await page.reload();
      await expect(page.locator(`tr[data-summary-line="Камерваген ${RUN}"]`)).toBeVisible();
      expect(await page.locator("main").innerText()).not.toMatch(/(TR|OP|ZV)-\d{2}/);
    } finally {
      await context.close();
    }
  });

  test("утверждённые версии в сводной и в плане/факте: группы строк, резерв и агентские в плане, без кодов", async ({ browser }) => {
    const { context, page } = await openAs(browser, "producer");
    try {
      for (const key of ["a", "b", "c"] as const) await submitAndApprove(page, key);

      await page.goto(`${base()}/summary`);
      await expect(page.locator(`tr[data-summary-department="${DEPT_NAMES.a}"]`)).toContainText("версия 1");
      await expect(page.locator("[data-summary-total]")).toContainText("269 100,00");

      await page.goto(`${base()}/plan-fact`);
      await expect(page.getByText("Транспорт / Спецтранспорт")).toBeVisible();
      await expect(page.locator("[data-plan-fact-reserve]")).toContainText("23 400");
      await expect(page.locator("[data-plan-fact-agency]")).toContainText("11 700");
      await expect(page.locator("main")).toContainText("269 100");
      expect(await page.locator("main").innerText()).not.toMatch(/(TR|OP|ZV)-\d{2}/);
    } finally {
      await context.close();
    }
  });

  test("смена переменной: пересчёт утверждает продюсер — одна смета и «все»; где глава правил — обычный порядок", async ({ browser }) => {
    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(`/ru/projects/${state.projectId}/finance/settings`);
      await page.locator("#val-SMENY").fill("12");
      await page.locator("#val-SMENY").locator("xpath=ancestor::form").getByRole("button", { name: "Сохранить" }).click();
      for (const key of ["a", "b", "c"] as const) await expect.poll(() => status(key)).toBe(BudgetStatus.DRAFT);

      // В цехе B глава правит строку — это уже не «только пересчёт».
      await page.goto(`${base()}/${state.depts.b.id}`);
      await page.locator(`tr[data-budget-line="Тонваген ${RUN}"]`).getByLabel("Ставка").fill("5500");
      await page.keyboard.press("Enter");
      await expect
        .poll(async () => (await db.budgetItem.findUniqueOrThrow({ where: { id: state.bLineId } })).rate?.toString())
        .toBe("5500");
      await page.reload();
      await expect(page.locator("[data-variables-changed]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Утвердить пересчёт" })).toHaveCount(0);

      // Цех A: кнопка в смете — версия 2 «пересчёт по переменным».
      await page.goto(`${base()}/${state.depts.a.id}`);
      await expect(page.locator("[data-variables-changed]")).toContainText("СМЕНЫ 10 → 12");
      await page.getByRole("button", { name: "Утвердить пересчёт" }).click();
      const confirm = page.getByRole("dialog", { name: /Утвердить пересчёт/ });
      await expect(confirm).toContainText("159 000,00 → 190 800,00");
      state.singleRecalcId = await nextActionId(page, () => confirm.getByRole("button", { name: "Утвердить пересчёт" }).click());
      await expect.poll(() => status("a")).toBe(BudgetStatus.APPROVED);
      const v2 = await db.budgetVersion.findFirstOrThrow({
        where: { budgetId: state.depts.a.budgetId, number: 2 },
        select: { recalcByVariables: true, total: true, submittedById: true },
      });
      expect(v2).toEqual({ recalcByVariables: true, total: new Prisma.Decimal("190800"), submittedById: null });

      // Список смет: в панели — только C (B правили, A уже утверждён). «Утвердить все».
      await page.goto(base());
      const panel = page.locator("[data-recalc-panel]");
      await expect(panel.locator("[data-recalc-department]")).toHaveCount(1);
      await expect(panel.locator(`[data-recalc-department="${DEPT_NAMES.c}"]`)).toContainText("10 000,00 → 12 000,00");
      await panel.getByRole("button", { name: "Утвердить все пересчитанные (1)" }).click();
      state.allRecalcId = await nextActionId(page, () =>
        page.getByRole("dialog", { name: /Утвердить все пересчитанные/ }).getByRole("button", { name: "Утвердить все" }).click(),
      );
      await expect.poll(() => status("c")).toBe(BudgetStatus.APPROVED);
      await expect(page.locator("[data-recalc-panel]")).toHaveCount(0);

      // B — обычный порядок: подделанный запрос «утвердить пересчёт» — отказ, версии нет.
      const forged = await callAction(page, base(), state.singleRecalcId!, [state.projectId, state.depts.b.id, { fingerprint: "0".repeat(64) }]);
      expect(forged.body).toContain("Это не пересчёт по переменным");
      expect(await status("b")).toBe(BudgetStatus.DRAFT);
      expect(await db.budgetVersion.count({ where: { budgetId: state.depts.b.budgetId } })).toBe(1);

      // Версии цеха A: пометка «пересчёт по переменным».
      await page.goto(`${base()}/${state.depts.a.id}/versions`);
      await expect(page.locator("[data-version-recalc]")).toHaveCount(1);
      await page.goto(`${base()}/${state.depts.a.id}/versions/2`);
      await expect(page.locator("[data-version-recalc]")).toContainText("Пересчёт по переменным");
    } finally {
      await context.close();
    }
  });

  test("не продюсер: «утвердить пересчёт» и «все пересчитанные» — отказ", async ({ browser }) => {
    test.skip(!state.singleRecalcId || !state.allRecalcId, "нет id действий из теста продюсера");
    // Ещё один пересчёт, чтобы было что утверждать.
    await db.projectFinanceVariable.update({ where: { id: state.smenyId }, data: { value: 12 } });
    const { context, page } = await openAs(browser, "nofin");
    try {
      await page.goto(`/ru/projects/${state.projectId}`);
      const single = await callAction(page, `/ru/projects/${state.projectId}`, state.singleRecalcId!, [
        state.projectId,
        state.depts.a.id,
        { fingerprint: "0".repeat(64) },
      ]);
      expect(single.body).toContain("Недостаточно прав");
      const all = await callAction(page, `/ru/projects/${state.projectId}`, state.allRecalcId!, [
        state.projectId,
        { items: [{ departmentId: state.depts.b.id, fingerprint: "0".repeat(64) }] },
      ]);
      expect(all.body).toContain("Недостаточно прав");
      // Сводная — только продюсеру и «просмотру всех»: главе без прав — «не найдено».
      const res = await page.goto(`${base()}/summary`);
      expect(res?.status()).toBe(404);
    } finally {
      await context.close();
    }
    expect(await db.budgetVersion.count({ where: { projectId: state.projectId, recalcByVariables: true } })).toBe(2);
  });
});
