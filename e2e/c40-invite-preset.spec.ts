import { expect, test, type Browser } from "@playwright/test";
import { MembershipStatus, Prisma, ProjectType } from "@prisma/client";
import { getDefaultProjectRoles } from "../src/features/roles/default-roles";
import { E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, storageStatePath } from "./helpers/session";

/**
 * Шаблоны ролей, шаг 4: приглашение по шаблону. Быстрый выбор роли из шаблонов, цех в
 * приглашении (кто примет — станет главой цеха), отказ на цех чужого проекта — по ответу сервера.
 * Тест работает на своём временном проекте и в конце удаляет его целиком.
 */

const ctx = e2eContext();
const db = e2eDb();
const RUN = Date.now().toString(36);
const DEPARTMENT = `Операторский цех ${RUN}`;

const state = { projectId: "", departmentId: "", dopRoleId: "", token: "", acceptorId: "" };

async function openAs(browser: Browser, role: keyof typeof E2E_ROLES) {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return { context, page: await context.newPage() };
}

const members = () => `/ru/projects/${state.projectId}/members`;

test.describe.serial("приглашение по шаблону роли", () => {
  test.beforeAll(async () => {
    const [producer, acceptor] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } }),
      db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.crewonly.email }, select: { id: true } }),
    ]);
    state.acceptorId = acceptor.id;
    const project = await db.project.create({
      data: { name: `E2E приглашение по шаблону ${RUN}`, type: ProjectType.FEATURE, createdById: producer.id, ownerUserId: producer.id },
      select: { id: true },
    });
    state.projectId = project.id;
    // Роли — как у нового проекта: системные и шаблоны.
    for (const role of getDefaultProjectRoles()) {
      const row = await db.projectRoleDefinition.create({
        data: {
          projectId: project.id,
          name: role.name,
          note: role.note,
          isSystem: role.isSystem,
          permissions: role.permissions as unknown as Prisma.InputJsonValue,
          presetKey: role.presetKey,
        },
        select: { id: true },
      });
      if (role.name === "Продюсер") {
        await db.projectMembership.create({ data: { projectId: project.id, userId: producer.id, roleId: row.id } });
      }
      if (role.presetKey === "dop") state.dopRoleId = row.id;
    }
    const department = await db.department.create({
      data: { projectId: project.id, name: DEPARTMENT, codePrefix: "OP" },
      select: { id: true },
    });
    state.departmentId = department.id;
  });

  test.afterAll(async () => {
    if (state.projectId) await db.project.delete({ where: { id: state.projectId } });
    await db.$disconnect();
  });

  test("быстрый выбор шаблона, описание роли, подсказка про цех; приглашение с цехом", async ({ browser }) => {
    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(members());
      const chips = page.getByRole("group", { name: "Шаблоны ролей" }).getByRole("button");
      await expect(chips).toHaveCount(9);
      await chips.filter({ hasText: "Оператор-постановщик" }).click();
      await expect(page.locator("#roleId")).toHaveValue(state.dopRoleId);
      await expect(page.getByTestId("invite-role-note")).toContainText("Правит смету своего цеха");
      await expect(page.getByTestId("invite-department-hint")).toBeVisible();

      await page.locator("#departmentId-trigger").click();
      await page.getByRole("option", { name: DEPARTMENT }).click();
      await expect(page.getByTestId("invite-department-hint")).toHaveCount(0);

      await page.getByRole("button", { name: "Создать ссылку" }).click();

      await expect.poll(() => db.projectInvite.count({ where: { projectId: state.projectId } })).toBe(1);
      const invite = await db.projectInvite.findFirstOrThrow({
        where: { projectId: state.projectId },
        select: { roleId: true, departmentId: true, token: true },
      });
      expect(invite.roleId).toBe(state.dopRoleId);
      expect(invite.departmentId).toBe(state.departmentId);
      state.token = invite.token;
      await expect(page.getByText(`глава цеха «${DEPARTMENT}»`)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("цех другого проекта в приглашении — отказ сервера, приглашения нет", async ({ browser }) => {
    const foreign = await db.department.findFirstOrThrow({ where: { projectId: ctx.projectId }, select: { id: true } });
    const { context, page } = await openAs(browser, "producer");
    try {
      await page.goto(members());
      const before = await db.projectInvite.count({ where: { projectId: state.projectId } });
      // Подделка из браузера: в скрытый список цехов подставлен цех чужого проекта.
      await page.locator("#departmentId").evaluate((select, id) => {
        const el = select as HTMLSelectElement;
        el.add(new Option("чужой", id));
        el.value = id;
      }, foreign.id);
      const response = page.waitForResponse((r) => Boolean(r.request().headers()["next-action"]));
      await page.getByRole("button", { name: "Создать ссылку" }).click();
      // Ответ сервера — ошибка (в ответе нет charset, кириллица приходит искажённой — текст
      // проверяем в форме, куда его выводит страница), приглашение не создано.
      expect(await (await response).text()).toContain('"error"');
      await expect(page.getByRole("alert").filter({ hasText: "Цех не найден" })).toBeVisible();
      expect(await db.projectInvite.count({ where: { projectId: state.projectId } })).toBe(before);
    } finally {
      await context.close();
    }
  });

  test("принявший становится участником с ролью шаблона и главой цеха; видит смету своего цеха", async ({ browser }) => {
    expect(state.token).not.toBe("");
    const { context, page } = await openAs(browser, "crewonly");
    try {
      await page.goto(`/ru/invite/${state.token}`);
      await expect(page.getByText(DEPARTMENT)).toBeVisible();
      await page.getByRole("button", { name: "Принять приглашение" }).click();
      await page.waitForURL(new RegExp(`/ru/projects/${state.projectId}`));

      const membership = await db.projectMembership.findFirstOrThrow({
        where: { projectId: state.projectId, userId: state.acceptorId },
        select: { id: true, roleId: true, status: true, departmentHeads: { select: { departmentId: true } } },
      });
      expect(membership.roleId).toBe(state.dopRoleId);
      expect(membership.status).toBe(MembershipStatus.ACTIVE);
      expect(membership.departmentHeads.map((h) => h.departmentId)).toEqual([state.departmentId]);
      const journal = await db.auditLog.findFirst({
        where: { projectId: state.projectId, entityId: membership.id },
        select: { summary: true },
      });
      expect(journal?.summary).toContain(`назначен главой цеха «${DEPARTMENT}»`);

      // Смета своего цеха открывается, финансы и участники — нет (ответ сервера).
      const smeta = await page.request.get(`/ru/projects/${state.projectId}/smeta`);
      expect(await smeta.text()).toContain(DEPARTMENT);
      await page.goto(`/ru/projects/${state.projectId}/finance`);
      await expect(page.getByText(/Нет доступа/).first()).toBeVisible();
      await page.goto(members());
      await expect(page.getByText("Нет доступа", { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
