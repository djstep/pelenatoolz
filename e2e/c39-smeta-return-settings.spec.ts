import { expect, test, type Browser, type Page } from "@playwright/test";
import { BudgetStatus, Prisma, ProjectType } from "@prisma/client";
import { E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, storageStatePath } from "./helpers/session";

/**
 * Шаблоны ролей, шаг 2: два новых права.
 * «Сметы — вернуть на доработку» — вернуть главе ту смету, которую видишь; утверждает по-прежнему
 * только продюсер. «Сметы — настройки» — переменные и справочники сметы; правка начислений и
 * платежей («Финансы») их больше не даёт. Проверка — по ответу сервера на подделанные запросы.
 * Тест работает на своём временном проекте и в конце удаляет его целиком.
 */

const ctx = e2eContext();
const db = e2eDb();
const RUN = Date.now().toString(36);

const state = { projectId: "", departmentId: "", budgetId: "", roleId: "", userId: "", returnId: "", resetId: "" };

const FINANCE_WRITE = { access: true, read: true, create: true, update: true, delete: true, financeRead: true };
const SMETA_ALL = { access: true, read: true };

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

const review = () => `/ru/projects/${state.projectId}/smeta/${state.departmentId}/review`;
const settings = () => `/ru/projects/${state.projectId}/finance/settings`;

/** Права роли «линейного продюсера» во временном проекте. */
async function setRole(permissions: Record<string, unknown>) {
  await db.projectRoleDefinition.update({
    where: { id: state.roleId },
    data: { permissions: permissions as Prisma.InputJsonValue },
  });
}

async function submitBudget() {
  await db.budget.update({
    where: { id: state.budgetId },
    data: { status: BudgetStatus.SUBMITTED, submittedAt: new Date(), returnedAt: null, returnComment: null },
  });
}

const budgetStatus = async () =>
  (await db.budget.findUniqueOrThrow({ where: { id: state.budgetId }, select: { status: true } })).status;

const smenyValue = async () =>
  (await db.projectFinanceVariable.findFirstOrThrow({ where: { projectId: state.projectId, key: "SMENY" } })).value?.toString() ?? null;

test.describe.serial("права смет: вернуть на доработку и настройки сметы", () => {
  test.beforeAll(async () => {
    const [producer, lineProducer] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } }),
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.crewonly.email }, select: { id: true } }),
    ]);
    state.userId = lineProducer.id;
    const producerRole = await db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, userId: producer.id },
      select: { role: { select: { name: true, note: true, isSystem: true, permissions: true } } },
    });
    const project = await db.project.create({
      data: { name: `E2E права смет ${RUN}`, type: ProjectType.FEATURE, createdById: producer.id, ownerUserId: producer.id },
      select: { id: true },
    });
    state.projectId = project.id;
    const pRole = await db.projectRoleDefinition.create({
      data: { projectId: project.id, ...producerRole.role, permissions: producerRole.role.permissions as Prisma.InputJsonValue },
      select: { id: true },
    });
    await db.projectMembership.create({ data: { projectId: project.id, userId: producer.id, roleId: pRole.id } });
    const lpRole = await db.projectRoleDefinition.create({
      data: { projectId: project.id, name: `E2E линейный ${RUN}`, permissions: {} },
      select: { id: true },
    });
    state.roleId = lpRole.id;
    await db.projectMembership.create({ data: { projectId: project.id, userId: lineProducer.id, roleId: lpRole.id } });

    await db.projectFinanceVariable.create({
      data: { projectId: project.id, key: "SMENY", label: "СМЕНЫ", value: 10, isSystem: true, sortOrder: 1 },
    });
    const department = await db.department.create({
      data: { projectId: project.id, name: `Операторский цех ${RUN}`, codePrefix: "OP" },
      select: { id: true },
    });
    state.departmentId = department.id;
    const budget = await db.budget.create({
      data: { projectId: project.id, departmentId: department.id, createdById: producer.id },
      select: { id: true },
    });
    state.budgetId = budget.id;
    await submitBudget();
  });

  test.afterAll(async () => {
    if (state.projectId) await db.project.delete({ where: { id: state.projectId } });
    await db.$disconnect();
  });

  test("«вернуть на доработку»: кнопка «Вернуть главе» есть, «Утвердить» нет; возврат проходит", async ({ browser }) => {
    await setRole({ smeta_all: SMETA_ALL, smeta_return: { access: true }, finance: FINANCE_WRITE });
    const { context, page } = await openAs(browser, "crewonly");
    try {
      await page.goto(review());
      await expect(page.getByRole("button", { name: "Вернуть главе" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Утвердить", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Вернуть главе" }).click();
      const dialog = page.getByRole("dialog", { name: "Вернуть смету главе" });
      await dialog.getByRole("textbox").fill("Уточните аренду");
      state.returnId = await nextActionId(page, () => dialog.getByRole("button", { name: "Вернуть" }).click());
      await expect.poll(budgetStatus).toBe(BudgetStatus.RETURNED);
      const budget = await db.budget.findUniqueOrThrow({ where: { id: state.budgetId }, select: { returnedById: true } });
      expect(budget.returnedById).toBe(state.userId);
    } finally {
      await context.close();
    }
  });

  test("без флага или без доступа к смете — возврат отказан сервером", async ({ browser }) => {
    expect(state.returnId).not.toBe("");
    const { context, page } = await openAs(browser, "crewonly");
    try {
      for (const permissions of [
        // Видит все сметы и правит финансы, но вернуть не может.
        { smeta_all: SMETA_ALL, finance: FINANCE_WRITE },
        // Флаг есть, а сметы этого цеха не видит.
        { smeta_return: { access: true }, finance: FINANCE_WRITE },
      ]) {
        await submitBudget();
        await setRole(permissions);
        await page.goto(`/ru/projects/${state.projectId}`);
        const forged = await callAction(page, review(), state.returnId, [state.projectId, state.departmentId, { comment: "подделка" }]);
        expect(forged.body).toContain("Недостаточно прав");
        expect(await budgetStatus()).toBe(BudgetStatus.SUBMITTED);
      }
      await setRole({ smeta_all: SMETA_ALL, finance: FINANCE_WRITE });
      await page.goto(review());
      await expect(page.getByText("Сравнение —").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Вернуть главе" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("«Сметы — настройки»: правка финансов переменные не меняет, флаг — меняет", async ({ browser }) => {
    // Id действия «Сбросить» — с экрана продюсера.
    const producer = await openAs(browser, "producer");
    try {
      await producer.page.goto(settings());
      state.resetId = await nextActionId(producer.page, () =>
        producer.page.locator("#val-SMENY").locator("xpath=ancestor::form").getByRole("button", { name: "Сбросить" }).click(),
      );
      await expect.poll(smenyValue).toBe(null);
    } finally {
      await producer.context.close();
    }
    await db.projectFinanceVariable.updateMany({ where: { projectId: state.projectId, key: "SMENY" }, data: { value: 10 } });

    const { context, page } = await openAs(browser, "crewonly");
    try {
      await setRole({ smeta_all: SMETA_ALL, finance: FINANCE_WRITE, smeta_settings: { access: false } });
      await page.goto(settings());
      await expect(page.locator("#val-SMENY")).toBeVisible();
      await expect(page.locator("#val-SMENY").locator("xpath=ancestor::form").getByRole("button", { name: "Сбросить" })).toHaveCount(0);
      const refused = await callAction(page, settings(), state.resetId, [state.projectId, "SMENY"]);
      expect(refused.body).toContain("Сметы — настройки");
      expect(await smenyValue()).toBe("10");

      await setRole({ smeta_all: SMETA_ALL, finance: FINANCE_WRITE, smeta_settings: { access: true } });
      const allowed = await callAction(page, settings(), state.resetId, [state.projectId, "SMENY"]);
      expect(allowed.body).not.toContain("Недостаточно прав");
      await expect.poll(smenyValue).toBe(null);
    } finally {
      await context.close();
    }
  });
});
