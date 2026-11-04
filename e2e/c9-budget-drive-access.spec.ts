import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_ROLES, type E2ERoleKey } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, stateShot, storageStatePath } from "./helpers/session";

/**
 * Папки смет на диске проекта (`BUDGET_DRIVE_NOTES.md`, шаг 3) — настоящий пересчёт доступов и
 * база против заглушки, без страниц (кнопок выгрузки смет ещё нет). Папки и пересчёт — через
 * `e2e/helpers/budget-drive.ts` (отдельный процесс, как сервер).
 * Нужен `E2E_CLOUD_STUB_URL`; без него — пропуск.
 */

const STUB = process.env.E2E_CLOUD_STUB_URL?.replace(/\/+$/, "");
const ctx = e2eContext();
const db = e2eDb();
const MANUAL_EMAIL = "friend-of-keeper@gmail.com";

type StubPermission = { id: string; fileId: string; type: string; role: string; emailAddress: string | null; manual?: boolean };
type StubFile = { id: string; name: string; parents: string[] };
type StubState = { google: { files: StubFile[]; permissions: StubPermission[] } };

async function stub<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${STUB}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

function helper<T>(...args: string[]): T {
  const out = execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "e2e/helpers/budget-drive.ts", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "development", CLOUD_STUB_GOOGLE_URL: `${STUB}/google` },
      timeout: 90_000,
    },
  );
  return JSON.parse(out.trim().split("\n").pop() ?? "{}") as T;
}

const sync = () => helper<{ status: string; added: number; removed: number }>("sync", ctx.projectId, users.producer);

/** Почта, на которую система выдаёт доступ: «Почта для Google», иначе почта входа. */
function grantEmail(role: E2ERoleKey) {
  return E2E_ROLES[role].email.toLowerCase();
}

async function folderId(key: string) {
  const row = await db.driveFolder.findFirstOrThrow({
    where: { projectId: ctx.projectId, projectDrive: { projectId: ctx.projectId }, key },
    select: { externalId: true },
  });
  return row.externalId;
}

/** Кому выдан доступ к папке у «Google» (без владельца): почты, по алфавиту. */
async function emailsOf(key: string, opts: { manual?: boolean } = {}) {
  const fileId = await folderId(key);
  const { google } = await stub<StubState>("/state");
  return google.permissions
    .filter((p) => p.fileId === fileId && (opts.manual === undefined || Boolean(p.manual) === opts.manual))
    .map((p) => p.emailAddress ?? p.type)
    .sort();
}

const users = { producer: "", nofin: "", nocallsheet: "" };
const memberships = { producer: "", nofin: "", nocallsheet: "" };
let restore: {
  heads: { departmentId: string; membershipId: string }[];
  googleEmails: { email: string; googleEmail: string | null }[];
  nocallsheetRoleId: string;
  departmentName: string;
};
const transportKey = () => `budget-dept:${ctx.departmentId}`;

test.describe.configure({ mode: "serial" });
test.skip(!STUB, "нет E2E_CLOUD_STUB_URL — папки смет проверяются только на заглушке");

test.beforeAll(async () => {
  for (const role of ["producer", "nofin", "nocallsheet"] as const) {
    const m = await db.projectMembership.findFirstOrThrow({
      where: { projectId: ctx.projectId, user: { email: E2E_ROLES[role].email } },
      select: { id: true, userId: true },
    });
    users[role] = m.userId;
    memberships[role] = m.id;
  }
  const emails = Object.values(E2E_ROLES).map((r) => r.email);
  restore = {
    heads: await db.departmentHead.findMany({
      where: { departmentId: ctx.departmentId },
      select: { departmentId: true, membershipId: true },
    }),
    googleEmails: await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, googleEmail: true } }),
    nocallsheetRoleId: (await db.projectMembership.findUniqueOrThrow({ where: { id: memberships.nocallsheet } })).roleId,
    departmentName: (await db.department.findUniqueOrThrow({ where: { id: ctx.departmentId } })).name,
  };
  // Доступ — на почту входа (как без «Почты для Google»).
  await db.user.updateMany({ where: { email: { in: emails } }, data: { googleEmail: null } });
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  // Глава «Транспортного цеха» — роль без финансов (решение 6в: доступ к смете цеха без «Финансы: просмотр»).
  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });
  await stub("/reset", {});
  helper("connect", ctx.projectId, memberships.producer);
});

test.afterAll(async () => {
  if (!STUB) return;
  await db.projectDrive.deleteMany({ where: { projectId: ctx.projectId } });
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId } });
  if (restore.heads.length) await db.departmentHead.createMany({ data: restore.heads });
  await db.projectMembership.update({
    where: { id: memberships.nocallsheet },
    data: { roleId: restore.nocallsheetRoleId, status: "ACTIVE" },
  });
  await db.projectMembership.update({ where: { id: memberships.nofin }, data: { status: "ACTIVE" } });
  await db.department.update({ where: { id: ctx.departmentId }, data: { name: restore.departmentName } });
  for (const u of restore.googleEmails) {
    await db.user.update({ where: { email: u.email }, data: { googleEmail: u.googleEmail } });
  }
  await db.$disconnect();
});

test("папки смет: цепочка, «Сводная» — продюсеру, цех — главе без финансов и продюсеру; верхние — только владелец", async () => {
  helper("ensure", ctx.projectId, users.producer, "summary");
  helper("ensure", ctx.projectId, users.producer, ctx.departmentId);

  const { google } = await stub<StubState>("/state");
  const name = async (key: string) => {
    const id = await folderId(key);
    return google.files.find((f) => f.id === id)?.name;
  };
  expect(await name("budgets")).toBe("Сметы");
  expect(await name("budget-summary")).toBe("Сводная");
  expect(await name("budget-departments")).toBe("Цеха");
  expect(await name(transportKey())).toBe(restore.departmentName);

  expect(await emailsOf("budget-summary")).toEqual([grantEmail("producer")]);
  expect(await emailsOf(transportKey())).toEqual([grantEmail("nofin"), grantEmail("producer")].sort());
  for (const key of ["root", "budgets", "budget-departments"]) {
    expect(await emailsOf(key), key).toEqual([]);
  }
  const grants = await db.driveFolderGrant.findMany({
    where: { folder: { projectId: ctx.projectId, key: { in: ["budget-summary", transportKey()] } } },
    select: { role: true, status: true },
  });
  expect(grants.every((g) => g.role === "commenter" && g.status === "OK")).toBe(true);
});

test("сняли главу цеха — доступ к папке сметы цеха снят; назначили снова — выдан", async () => {
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });
  expect((await sync()).removed).toBe(1);
  expect(await emailsOf(transportKey())).toEqual([grantEmail("producer")]);

  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });
  expect((await sync()).added).toBe(1);
  expect(await emailsOf(transportKey())).toEqual([grantEmail("nofin"), grantEmail("producer")].sort());
});

test("роль стала «Продюсер» — «Сводная» и все цеха; роль вернули — доступы сняты", async () => {
  const producerRole = await db.projectRoleDefinition.findFirstOrThrow({
    where: { projectId: ctx.projectId, isSystem: true, name: "Продюсер" },
    select: { id: true },
  });
  await db.projectMembership.update({ where: { id: memberships.nocallsheet }, data: { roleId: producerRole.id } });
  await sync();
  expect(await emailsOf("budget-summary")).toContain(grantEmail("nocallsheet"));
  expect(await emailsOf(transportKey())).toContain(grantEmail("nocallsheet"));

  await db.projectMembership.update({
    where: { id: memberships.nocallsheet },
    data: { roleId: restore.nocallsheetRoleId },
  });
  await sync();
  expect(await emailsOf("budget-summary")).not.toContain(grantEmail("nocallsheet"));
  expect(await emailsOf(transportKey())).not.toContain(grantEmail("nocallsheet"));
});

test("участника удалили из проекта — доступ снят; вернули — выдан", async () => {
  await db.projectMembership.update({ where: { id: memberships.nofin }, data: { status: "REMOVED" } });
  await sync();
  expect(await emailsOf(transportKey())).toEqual([grantEmail("producer")]);
  await db.projectMembership.update({ where: { id: memberships.nofin }, data: { status: "ACTIVE" } });
  await sync();
  expect(await emailsOf(transportKey())).toEqual([grantEmail("nofin"), grantEmail("producer")].sort());
});

test("цех переименовали — переименованы папки цеха и в «Сметах»", async () => {
  await db.department.update({ where: { id: ctx.departmentId }, data: { name: "Транспорт (e2e)" } });
  const { renamed } = helper<{ renamed: number }>("rename", ctx.projectId, ctx.departmentId, users.producer);
  expect(renamed).toBe(1);
  const { google } = await stub<StubState>("/state");
  const id = await folderId(transportKey());
  expect(google.files.find((f) => f.id === id)?.name).toBe("Транспорт (e2e)");
  await db.department.update({ where: { id: ctx.departmentId }, data: { name: restore.departmentName } });
  helper("rename", ctx.projectId, ctx.departmentId, users.producer);
});

test("чужие доступы к папкам смет: предупреждение продюсерам, журнал без почт, ничего не снято", async ({ browser }) => {
  await stub(`/google/files/${await folderId("budget-summary")}/permissions`, { email: MANUAL_EMAIL, role: "writer" });
  await stub(`/google/files/${await folderId("budgets")}/permissions`, { type: "anyone", role: "reader" });
  const before = await db.auditLog.findFirst({
    where: { projectId: ctx.projectId, entityType: "project_drive" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  await sync();
  const overview = helper<{
    foreign: { folder: string; count: number; who: string[] }[];
  }>("overview", ctx.projectId);
  expect(overview.foreign.map((w) => [w.folder, w.count, w.who]).sort()).toEqual(
    [
      ["Сметы", 1, ["все, у кого есть ссылка"]],
      ["Сметы / Сводная", 1, [MANUAL_EMAIL]],
    ].sort(),
  );
  if (process.env.E2E_STATE_SHOTS) {
    const context = await browser.newContext({ storageState: storageStatePath("producer") });
    const page = await context.newPage();
    await page.goto(projectPath(ctx, "/settings"));
    await page.getByTestId("project-drive-foreign").waitFor();
    await stateShot(page, "drive-foreign-access", "project-drive-foreign");
    await context.close();
  }
  // Система ничего не сняла.
  expect(await emailsOf("budget-summary", { manual: true })).toEqual([MANUAL_EMAIL]);
  expect(await emailsOf("budgets", { manual: true })).toEqual(["anyone"]);

  const audit = await db.auditLog.findMany({
    where: {
      projectId: ctx.projectId,
      entityType: "project_drive",
      ...(before ? { createdAt: { gt: before.createdAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { summary: true, changes: true },
  });
  const foreign = audit.find((a) => a.summary?.includes("выданные не системой"));
  expect(foreign?.summary).toContain("К папкам смет на диске проекта есть доступы, выданные не системой: 2");
  expect(JSON.stringify(audit)).not.toContain("@");

  // Повторный пересчёт без изменений — новой записи о чужих доступах нет.
  await sync();
  const again = await db.auditLog.count({
    where: {
      projectId: ctx.projectId,
      entityType: "project_drive",
      summary: { contains: "выданные не системой" },
      ...(before ? { createdAt: { gt: before.createdAt } } : {}),
    },
  });
  expect(again).toBe(1);
});

test("ошибка Google при выдаче по папке сметы — строка «не синхронизировано» с пометкой «смета»", async () => {
  await db.departmentHead.deleteMany({ where: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });
  await sync();
  await stub("/config", {
    failNext: [
      {
        provider: "google",
        match: "permissions.create",
        status: 400,
        body: { error: { code: 400, message: "Bad Request", errors: [{ reason: "invalidSharingRequest" }] } },
      },
    ],
  });
  await db.departmentHead.create({ data: { departmentId: ctx.departmentId, membershipId: memberships.nofin } });
  expect((await sync()).status).toBe("partial");
  const overview = helper<{ unsynced: { folder: string; budget: boolean; action: string }[] }>("overview", ctx.projectId);
  expect(overview.unsynced).toEqual([
    expect.objectContaining({ folder: `Сметы / Цеха / ${restore.departmentName}`, budget: true, action: "add" }),
  ]);
  await sync();
  expect(await emailsOf(transportKey())).toContain(grantEmail("nofin"));
});
