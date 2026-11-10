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

  test("у цеха уже есть глава: форма предупреждает, прежний глава остаётся, в журнале — оба", async ({ browser }) => {
    const acceptorName = (await db.user.findUniqueOrThrow({ where: { id: state.acceptorId }, select: { name: true } })).name!;
    const producer = await openAs(browser, "producer");
    let token = "";
    try {
      await producer.page.goto(members());
      await producer.page.getByRole("group", { name: "Шаблоны ролей" }).getByRole("button", { name: "Оператор-постановщик" }).click();
      await producer.page.locator("#departmentId-trigger").click();
      await producer.page.getByRole("option", { name: DEPARTMENT }).click();
      await expect(producer.page.getByTestId("invite-department-heads")).toContainText(acceptorName);
      await expect(producer.page.getByTestId("invite-department-heads")).toContainText("прежний не снимается");
      const before = await db.projectInvite.count({ where: { projectId: state.projectId } });
      await producer.page.getByRole("button", { name: "Создать ссылку" }).click();
      await expect.poll(() => db.projectInvite.count({ where: { projectId: state.projectId } })).toBe(before + 1);
      token = (await db.projectInvite.findFirstOrThrow({
        where: { projectId: state.projectId, acceptedAt: null, departmentId: state.departmentId },
        orderBy: { createdAt: "desc" },
        select: { token: true },
      })).token;
    } finally {
      await producer.context.close();
    }

    const second = await openAs(browser, "nocast");
    try {
      await second.page.goto(`/ru/invite/${token}`);
      await second.page.getByRole("button", { name: "Принять приглашение" }).click();
      await second.page.waitForURL(new RegExp(`/ru/projects/${state.projectId}`));
    } finally {
      await second.context.close();
    }
    const heads = await db.departmentHead.findMany({
      where: { departmentId: state.departmentId },
      select: { membership: { select: { userId: true } } },
    });
    const nocast = await db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.nocast.email }, select: { id: true } });
    expect(heads.map((h) => h.membership.userId).sort()).toEqual([state.acceptorId, nocast.id].sort());
    const journal = await db.auditLog.findFirstOrThrow({
      where: { projectId: state.projectId, userId: nocast.id, summary: { startsWith: "Принято приглашение" } },
      select: { summary: true },
    });
    expect(journal.summary).toContain(`прежние главы остаются: ${acceptorName}`);
  });

  test("цех удалён до принятия: вступил без цеха, на странице и в журнале сказано почему", async ({ browser }) => {
    const producer = await db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.producer.email }, select: { id: true } });
    const doomedName = `Цех на удаление ${RUN}`;
    const doomed = await db.department.create({
      data: { projectId: state.projectId, name: doomedName, codePrefix: "DL" },
      select: { id: true },
    });
    const token = `e2e-${RUN}-deleted-dept`;
    await db.projectInvite.create({
      data: {
        projectId: state.projectId,
        roleId: state.dopRoleId,
        token,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdById: producer.id,
        departmentId: doomed.id,
        departmentName: doomedName,
      },
    });
    await db.department.delete({ where: { id: doomed.id } });

    const nofin = await db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.nofin.email }, select: { id: true } });
    const { context, page } = await openAs(browser, "nofin");
    try {
      await page.goto(`/ru/invite/${token}`);
      await expect(page.getByText(`цех «${doomedName}» удалён`)).toBeVisible();
      await page.getByRole("button", { name: "Принять приглашение" }).click();
      await page.waitForURL(new RegExp(`/ru/projects/${state.projectId}`));
    } finally {
      await context.close();
    }
    const membership = await db.projectMembership.findFirstOrThrow({
      where: { projectId: state.projectId, userId: nofin.id },
      select: { roleId: true, departmentHeads: { select: { id: true } } },
    });
    expect(membership.roleId).toBe(state.dopRoleId);
    expect(membership.departmentHeads).toEqual([]);
    const journal = await db.auditLog.findFirstOrThrow({
      where: { projectId: state.projectId, userId: nofin.id, summary: { startsWith: "Принято приглашение" } },
      select: { summary: true },
    });
    expect(journal.summary).toContain(`вступил без цеха: цех «${doomedName}» удалён`);
  });

  test("приглашающий без прав: роль шире своей — отказ; без управления участниками — отказ сервера", async ({ browser }) => {
    // Участник из первого теста получает роль «только участники» (без цехов, договоров, финансов).
    const inviterRole = await db.projectRoleDefinition.create({
      data: {
        projectId: state.projectId,
        name: `E2E приглашающий ${RUN}`,
        permissions: {
          members: { access: true, read: true, create: true, update: true, delete: true },
          crew: { access: true, read: true },
        },
      },
      select: { id: true },
    });
    const emptyRole = await db.projectRoleDefinition.create({
      data: { projectId: state.projectId, name: `E2E пустая ${RUN}`, permissions: {} },
      select: { id: true },
    });
    const membership = await db.projectMembership.findFirstOrThrow({
      where: { projectId: state.projectId, userId: state.acceptorId },
      select: { id: true },
    });
    await db.projectMembership.update({ where: { id: membership.id }, data: { roleId: inviterRole.id } });

    const { context, page } = await openAs(browser, "crewonly");
    try {
      await page.goto(members());
      const count = () => db.projectInvite.count({ where: { projectId: state.projectId, createdById: state.acceptorId } });
      // Шаблон с правами шире своих — сервер отказывает.
      await page.getByRole("group", { name: "Шаблоны ролей" }).getByRole("button", { name: "Линейный продюсер" }).click();
      await page.getByRole("button", { name: "Создать ссылку" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Нельзя пригласить с правами шире ваших собственных" })).toBeVisible();
      expect(await count()).toBe(0);

      // Роль не шире своей — приглашение проходит; запрос запоминается для подделки.
      await page.locator("#roleId-trigger").click();
      await page.getByRole("option", { name: `E2E пустая ${RUN}` }).click();
      const request = page.waitForRequest((r) => Boolean(r.headers()["next-action"]));
      await page.getByRole("button", { name: "Создать ссылку" }).click();
      const sent = await request;
      await expect.poll(count).toBe(1);
      expect((await db.projectInvite.findFirstOrThrow({ where: { createdById: state.acceptorId, projectId: state.projectId } })).roleId).toBe(emptyRole.id);

      // Управление участниками отняли — тот же запрос сервер отклоняет, приглашения нет.
      await db.projectMembership.update({ where: { id: membership.id }, data: { roleId: state.dopRoleId } });
      const headers = sent.headers();
      const replay = await page.request.post(members(), {
        headers: {
          "next-action": headers["next-action"]!,
          "content-type": headers["content-type"]!,
          accept: headers["accept"] ?? "text/x-component",
          origin: new URL(page.url()).origin,
        },
        data: sent.postDataBuffer()!,
      });
      expect(replay.ok()).toBe(false);
      expect(await count()).toBe(1);
    } finally {
      await context.close();
    }
  });
});
