import { expect, test, type Browser, type Page } from "@playwright/test";
import { BudgetStatus, BudgetVersionFormat, Prisma, ProjectType } from "@prisma/client";
import { E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, storageStatePath } from "./helpers/session";

/**
 * Волна «Смета по статьям», шаг 6: отправка, утверждение и возврат на новой модели, версии
 * и их сравнение, пересчёт черновика и пометка «изменилась после утверждения» при смене
 * переменной. Версии в базе неизменяемы и удаляются только вместе с проектом, поэтому тест
 * работает на своём временном проекте и в конце удаляет его целиком.
 */

const ctx = e2eContext();
const db = e2eDb();
const RUN = Date.now().toString(36);

const state: {
  projectId: string;
  departmentId: string;
  budgetId: string;
  smenyId: string;
  nedeliId: string;
  approveId: string | null;
} = { projectId: "", departmentId: "", budgetId: "", smenyId: "", nedeliId: "", approveId: null };

const CAMERA = `Камерваген ${RUN}`;
const GRIM = `Гримваген ${RUN}`;

async function openAs(browser: Browser, role: keyof typeof E2E_ROLES) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

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

const path = (suffix = "") => `/ru/projects/${state.projectId}/smeta/${state.departmentId}${suffix}`;

async function budgetStatus() {
  return (await db.budget.findUniqueOrThrow({ where: { id: state.budgetId }, select: { status: true } })).status;
}

async function submitAsHead(page: Page, comment: string) {
  await page.goto(path());
  await page.getByRole("button", { name: "Отправить на утверждение" }).click();
  const dialog = page.getByRole("dialog", { name: "Отправить на утверждение" });
  await dialog.getByRole("textbox").fill(comment);
  await dialog.getByRole("button", { name: "Отправить" }).click();
  return dialog;
}

test.describe.serial("смета по статьям: утверждение и версии", () => {
  test.beforeAll(async () => {
    const [producer, head] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } }),
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.nofin.email }, select: { id: true } }),
    ]);
    const members = await db.projectMembership.findMany({
      where: { projectId: ctx.projectId, userId: { in: [producer.id, head.id] } },
      select: { userId: true, role: { select: { name: true, note: true, isSystem: true, permissions: true } } },
    });
    const project = await db.project.create({
      data: {
        name: `E2E смета утверждение ${RUN}`,
        type: ProjectType.FEATURE,
        createdById: producer.id,
        ownerUserId: producer.id,
        shootingDaysCount: 30,
      },
      select: { id: true },
    });
    state.projectId = project.id;
    // Роли — копии ролей этих людей в проекте «E2E приёмка»: продюсер и глава без финансов.
    const membershipIds = new Map<string, string>();
    for (const m of members) {
      const role = await db.projectRoleDefinition.create({
        data: {
          projectId: project.id,
          name: m.role.name,
          note: m.role.note,
          isSystem: m.role.isSystem,
          permissions: m.role.permissions as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      const membership = await db.projectMembership.create({
        data: { projectId: project.id, userId: m.userId, roleId: role.id },
        select: { id: true },
      });
      membershipIds.set(m.userId, membership.id);
    }

    const variables = [
      { key: "SMENY", label: "СМЕНЫ", value: 10, sortOrder: 1 },
      { key: "SERII", label: "СЕРИИ", value: null, sortOrder: 2 },
      { key: "DNI_PODGOTOVKI", label: "ДНИ ПОДГОТОВКИ", value: null, sortOrder: 3 },
      { key: "NEDELI", label: "НЕДЕЛИ", value: null, sortOrder: 4 },
    ];
    for (const v of variables) {
      const row = await db.projectFinanceVariable.create({
        data: { projectId: project.id, ...v, isSystem: true },
        select: { id: true },
      });
      if (v.key === "SMENY") state.smenyId = row.id;
      if (v.key === "NEDELI") state.nedeliId = row.id;
    }

    const department = await db.department.create({
      data: { projectId: project.id, name: `Транспортный цех ${RUN}`, codePrefix: "TR" },
      select: { id: true },
    });
    state.departmentId = department.id;
    await db.departmentHead.create({ data: { departmentId: department.id, membershipId: membershipIds.get(head.id)! } });
    const budget = await db.budget.create({
      data: { projectId: project.id, departmentId: department.id, createdById: producer.id },
      select: { id: true },
    });
    state.budgetId = budget.id;

    const template = await db.budgetTemplateArticle.create({
      data: { projectId: project.id, number: 1, name: "Транспорт", sortOrder: 1 },
      select: { id: true },
    });
    const article = await db.budgetArticle.create({
      data: { projectId: project.id, budgetId: budget.id, templateArticleId: template.id, lastSubarticleNumber: 1 },
      select: { id: true },
    });
    const sub = await db.budgetSubarticle.create({
      data: { projectId: project.id, articleId: article.id, number: 1, name: "Спецтранспорт", lastLineNumber: 2 },
      select: { id: true },
    });
    const line = (number: number, name: string, rate: number, variableId: string, total: number) => ({
      projectId: project.id,
      departmentId: department.id,
      subarticleId: sub.id,
      number,
      code: `TR-01.01.0${number}`,
      name,
      unit: "смена",
      quantity: 1,
      rate,
      taxPercent: 6,
      multiplier1VariableId: variableId,
      amount: total === 0 ? 0 : total / 1.06,
      tax: total === 0 ? 0 : total - total / 1.06,
      total,
      sortOrder: number,
    });
    await db.budgetItem.createMany({
      data: [line(1, CAMERA, 15000, state.smenyId, 159000), line(2, GRIM, 10000, state.nedeliId, 0)],
    });
  });

  test.afterAll(async () => {
    // Версии удаляются только вместе с проектом — каскадом.
    if (state.projectId) await db.project.delete({ where: { id: state.projectId } });
    await db.$disconnect();
  });

  test("глава отправляет: строка без суммы не даёт отправить; продюсер утверждает версию 1", async ({ browser }) => {
    const head = await openAs(browser, "nofin");
    try {
      // НЕДЕЛИ не задана — у «Гримвагена» нет суммы: отправить нельзя.
      const dialog = await submitAsHead(head.page, "первая версия");
      await expect(dialog).toContainText("1 строка без суммы");
      expect(await budgetStatus()).toBe(BudgetStatus.DRAFT);
      await dialog.getByRole("button", { name: "Отмена" }).click();

      await db.projectFinanceVariable.update({ where: { id: state.nedeliId }, data: { value: 2 } });
      const again = await submitAsHead(head.page, "первая версия");
      await expect(again).toHaveCount(0);
      await expect.poll(budgetStatus).toBe(BudgetStatus.SUBMITTED);
      await expect(head.page.getByText("На утверждении", { exact: true })).toBeVisible();
    } finally {
      await head.context.close();
    }

    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(path("/review"));
      await expect(page.getByRole("heading", { name: /^Сравнение — / })).toBeVisible();
      // 159 000 + 10 000 × 2 × 1,06 = 180 200; кодов строк на экране нет.
      await expect(page.getByText(CAMERA)).toBeVisible();
      await expect(page.locator("main")).toContainText("180 200");
      expect(await page.locator("main").innerText()).not.toMatch(/TR-\d{2}/);

      await page.getByRole("button", { name: "Утвердить" }).click();
      const confirm = page.getByRole("dialog", { name: /Создать версию/ });
      state.approveId = await nextActionId(page, () => confirm.getByRole("button", { name: "Утвердить" }).click());
      await expect(page).toHaveURL(new RegExp(`${path("/versions/1")}$`));

      const version = await db.budgetVersion.findFirstOrThrow({
        where: { budgetId: state.budgetId, number: 1 },
        select: { format: true, total: true, itemCount: true, snapshot: true, lines: { select: { budgetItemId: true } } },
      });
      expect(version.format).toBe(BudgetVersionFormat.ITEMS);
      expect(version.total.toFixed(2)).toBe("180200.00");
      expect(version.itemCount).toBe(2);
      expect(version.lines).toHaveLength(2);
      expect(await budgetStatus()).toBe(BudgetStatus.APPROVED);

      // Просмотр версии: строки, итог, переменные на момент утверждения; без кодов.
      await expect(page.locator(`tr[data-version-line="${CAMERA}"]`)).toContainText("× СМЕНЫ (10)");
      await expect(page.locator("[data-version-variable=\"СМЕНЫ\"]")).toContainText("10");
      await expect(page.locator("tfoot")).toContainText("180 200,00");
      expect(await page.locator("main").innerText()).not.toMatch(/TR-\d{2}/);
    } finally {
      await context.close();
    }
  });

  test("смена переменной: версия не меняется, черновик пересчитан, пометка с перечнем переменных", async ({ browser }) => {
    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(`/ru/projects/${state.projectId}/finance/settings`);
      const value = page.locator("#val-SMENY");
      await value.fill("12");
      await value.locator("xpath=ancestor::form").getByRole("button", { name: "Сохранить" }).click();
      await expect
        .poll(async () => (await db.projectFinanceVariable.findUniqueOrThrow({ where: { id: state.smenyId } })).value?.toString())
        .toBe("12");

      // Черновик: кэш строки пересчитан (15 000 × 12 × 1,06 = 190 800), статус — черновик.
      await expect
        .poll(async () => (await db.budgetItem.findFirstOrThrow({ where: { projectId: state.projectId, name: CAMERA } })).total.toFixed(2))
        .toBe("190800.00");
      expect(await budgetStatus()).toBe(BudgetStatus.DRAFT);
      const journal = await db.auditLog.findFirst({
        where: { projectId: state.projectId, entityId: state.budgetId, summary: { contains: "пересчитана" } },
        select: { summary: true },
      });
      expect(journal?.summary).toContain("СМЕНЫ = 12");
      expect(journal?.summary).toContain("изменилась после утверждения");

      // Версия 1 не изменилась.
      const v1 = await db.budgetVersion.findFirstOrThrow({ where: { budgetId: state.budgetId, number: 1 }, select: { total: true } });
      expect(v1.total.toFixed(2)).toBe("180200.00");

      // Пометка над сметой цеха — с перечнем переменных.
      await page.goto(path());
      const banner = page.locator("[data-variables-changed]");
      await expect(banner).toContainText("Изменилась после утверждения версии 1");
      await expect(banner).toContainText("СМЕНЫ 10 → 12");
      await expect(banner).not.toContainText("НЕДЕЛИ");

      // Вернули 10 — черновик снова совпадает с версией 1: «утверждена», пометки нет. Потом снова 12.
      const setSmeny = async (v: string) => {
        await page.goto(`/ru/projects/${state.projectId}/finance/settings`);
        await page.locator("#val-SMENY").fill(v);
        await page.locator("#val-SMENY").locator("xpath=ancestor::form").getByRole("button", { name: "Сохранить" }).click();
        await expect
          .poll(async () => (await db.projectFinanceVariable.findUniqueOrThrow({ where: { id: state.smenyId } })).value?.toString())
          .toBe(v);
      };
      await setSmeny("10");
      await expect.poll(budgetStatus).toBe(BudgetStatus.APPROVED);
      await page.goto(path());
      await expect(page.locator("[data-variables-changed]")).toHaveCount(0);
      await setSmeny("12");
      await expect.poll(budgetStatus).toBe(BudgetStatus.DRAFT);
    } finally {
      await context.close();
    }
  });

  test("повторная отправка: подделанный отпечаток и чужая роль — отказ; версия 2 и сравнение версий", async ({ browser }) => {
    const head = await openAs(browser, "nofin");
    try {
      await submitAsHead(head.page, "смены 12");
      await expect.poll(budgetStatus).toBe(BudgetStatus.SUBMITTED);
      // Глава не утверждает: подделанный запрос — отказ.
      const forged = await callAction(head.page, path(), state.approveId!, [state.projectId, state.departmentId, { fingerprint: "0".repeat(64) }]);
      expect(forged.body).toContain("Недостаточно прав");
    } finally {
      await head.context.close();
    }

    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(path("/review"));
      await expect(page.locator("[data-variables-changed]")).toContainText("СМЕНЫ 10 → 12");
      // Продюсер с отпечатком не того черновика — отказ, версия не создаётся.
      const stale = await callAction(page, path("/review"), state.approveId!, [state.projectId, state.departmentId, { fingerprint: "0".repeat(64) }]);
      expect(stale.body).toContain("обновите страницу");
      expect(await db.budgetVersion.count({ where: { budgetId: state.budgetId } })).toBe(1);

      await page.getByRole("button", { name: "Утвердить" }).click();
      await page.getByRole("dialog", { name: /Создать версию/ }).getByRole("button", { name: "Утвердить" }).click();
      await expect(page).toHaveURL(new RegExp(`${path("/versions/2")}$`));
      await expect(page.locator("tfoot")).toContainText("212 000,00");

      // Сравнение версий 1 и 2: изменена одна строка, суммы «было → стало», без кодов.
      await page.goto(path("/versions"));
      await page.getByRole("button", { name: "Сравнить" }).click();
      await expect(page).toHaveURL(new RegExp(`${path("/versions/compare")}\\?a=1&b=2$`));
      await expect(page.getByRole("heading", { name: /Версия 1 ↔ версия 2/ })).toBeVisible();
      await expect(page.locator("main")).toContainText("Изменено: 1");
      await expect(page.locator("main")).toContainText("180 200");
      await expect(page.locator("main")).toContainText("212 000");
      expect(await page.locator("main").innerText()).not.toMatch(/TR-\d{2}/);
    } finally {
      await context.close();
    }
  });

  test("СМЕНЫ из параметров проекта: сброс переменной и смена числа смен пересчитывают черновик", async ({ browser }) => {
    const cameraTotal = async () =>
      (await db.budgetItem.findFirstOrThrow({ where: { projectId: state.projectId, name: CAMERA } })).total.toFixed(2);
    const { context, page } = await openAs(browser, "producer");
    try {
      // Сброс: у СМЕНЫ своего значения нет — берётся из проекта (30 смен): 15 000 × 30 × 1,06.
      await page.goto(`/ru/projects/${state.projectId}/finance/settings`);
      await page.locator("#val-SMENY").locator("xpath=ancestor::form").getByRole("button", { name: "Сбросить" }).click();
      await expect.poll(cameraTotal).toBe("477000.00");

      // Параметры проекта: 31 смена — смета пересчитана в той же транзакции.
      await page.goto(`/ru/projects/${state.projectId}/settings`);
      await page.locator("#shootingDaysCount").fill("31");
      await page.getByRole("button", { name: "Сохранить изменения" }).click();
      await expect.poll(cameraTotal).toBe("492900.00");
      const journal = await db.auditLog.findFirst({
        where: { projectId: state.projectId, entityId: state.budgetId, summary: { contains: "параметры проекта" } },
        select: { summary: true },
      });
      expect(journal?.summary).toContain("пересчитана");

      await page.goto(path());
      await expect(page.locator("[data-variables-changed]")).toContainText("СМЕНЫ 12 → 31");
      const v2 = await db.budgetVersion.findFirstOrThrow({ where: { budgetId: state.budgetId, number: 2 }, select: { total: true } });
      expect(v2.total.toFixed(2)).toBe("212000.00");
    } finally {
      await context.close();
    }
  });

  test("возврат главе с комментарием", async ({ browser }) => {
    const item = await db.budgetItem.findFirstOrThrow({ where: { projectId: state.projectId, name: GRIM }, select: { id: true } });
    const head = await openAs(browser, "nofin");
    try {
      // Правка строки после утверждения — черновик; отправить снова.
      await head.page.goto(path());
      await head.page.locator(`tr[data-budget-line="${GRIM}"]`).getByLabel("Ставка").fill("11000");
      await head.page.keyboard.press("Enter");
      await expect
        .poll(async () => (await db.budgetItem.findUniqueOrThrow({ where: { id: item.id } })).rate?.toString())
        .toBe("11000");
      await submitAsHead(head.page, "гримваген дороже");
      await expect.poll(budgetStatus).toBe(BudgetStatus.SUBMITTED);
    } finally {
      await head.context.close();
    }

    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(path("/review"));
      await page.getByRole("button", { name: "Вернуть главе" }).click();
      const dialog = page.getByRole("dialog", { name: "Вернуть смету главе" });
      await dialog.getByRole("textbox").fill("Дорого, верните 10 000");
      await dialog.getByRole("button", { name: "Вернуть" }).click();
      await expect.poll(budgetStatus).toBe(BudgetStatus.RETURNED);
    } finally {
      await context.close();
    }

    const again = await openAs(browser, "nofin");
    try {
      await again.page.goto(path());
      await expect(again.page.getByText("«Дорого, верните 10 000»")).toBeVisible();
    } finally {
      await again.context.close();
    }
  });
});
