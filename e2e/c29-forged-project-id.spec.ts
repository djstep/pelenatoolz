import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Подделанный projectId в серверном действии. Раньше объект `{ not: "x" }` проходил проверку
 * доступа (находился «какой-то» проект пользователя) и попадал в запрос как фильтр — так можно
 * было изменить запись чужого проекта. Теперь id проверяется в общем месте: requireProjectContext,
 * requireProjectAccess и запросы под ними.
 */

const ctx = e2eContext();
const db = e2eDb();
const CREW_PATH = projectPath(ctx, "/crew");
const ORIGIN = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
const OWN = "Времянка подделки свой";
const OWN2 = "Времянка контроль подделки";
const FOREIGN = "Времянка подделки чужой";

let ownId: string;
let own2Id: string;
let foreignId: string;

async function cleanup() {
  await db.crewMember.deleteMany({ where: { lastName: { in: [OWN, OWN2, FOREIGN] } } });
}

test.beforeAll(async () => {
  await cleanup();
  expect(ctx.foreignProjectId, "чужой проект из сида").toBeTruthy();
  const project = await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
  const foreign = await db.project.findUniqueOrThrow({ where: { id: ctx.foreignProjectId! } });
  ownId = (
    await db.crewMember.create({
      data: { projectId: ctx.projectId, lastName: OWN, createdById: project.ownerUserId },
    })
  ).id;
  own2Id = (
    await db.crewMember.create({
      data: { projectId: ctx.projectId, lastName: OWN2, createdById: project.ownerUserId },
    })
  ).id;
  foreignId = (
    await db.crewMember.create({
      data: { projectId: foreign.id, lastName: FOREIGN, createdById: foreign.ownerUserId },
    })
  ).id;
});

test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

test.use({ storageState: storageStatePath("producer") });

/** id действия «В архив»: берём из настоящего нажатия на своего человека. */
async function archiveActionId(page: Page): Promise<string> {
  const ids: string[] = [];
  page.on("request", (request) => {
    const id = request.headers()["next-action"];
    if (id) ids.push(id);
  });
  await page.goto(CREW_PATH);
  const row = page.locator("main tbody tr").filter({ hasText: OWN });
  await row.getByRole("button", { name: new RegExp(`^${OWN}`) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "В архив" }).click();
  await expect(row).toHaveCount(0);
  expect(ids.length).toBeGreaterThan(0);
  return ids[ids.length - 1]!;
}

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
  return res.status();
}

test("подделанный projectId не меняет человека чужого проекта", async ({ page }) => {
  const actionId = await archiveActionId(page);
  // Настоящее нажатие сработало: свой человек в архиве.
  expect((await db.crewMember.findUniqueOrThrow({ where: { id: ownId } })).archivedAt).not.toBeNull();

  const forged: unknown[] = [
    { not: "x" },
    { in: [ctx.projectId, ctx.foreignProjectId] },
    [ctx.foreignProjectId],
    "",
    ctx.foreignProjectId,
  ];
  for (const projectId of forged) {
    await callAction(page, actionId, [projectId, foreignId]);
    const foreign = await db.crewMember.findUniqueOrThrow({ where: { id: foreignId } });
    expect(foreign.archivedAt, JSON.stringify(projectId)).toBeNull();
  }

  // Контроль: тот же вызов с настоящим projectId на своём человеке работает, то есть пойман
  // именно id действия «В архив», и тест выше не проходит впустую.
  expect(await callAction(page, actionId, [ctx.projectId, own2Id])).toBe(200);
  await expect
    .poll(async () => (await db.crewMember.findUniqueOrThrow({ where: { id: own2Id } })).archivedAt)
    .not.toBeNull();

  // Свой проект в адресе и чужой человек — тоже отказ.
  await callAction(page, actionId, [ctx.projectId, foreignId]);
  expect((await db.crewMember.findUniqueOrThrow({ where: { id: foreignId } })).archivedAt).toBeNull();
});

test("страница по подделанному адресу проекта — 404", async ({ page }) => {
  for (const bad of ["%7B%22not%22%3A%22x%22%7D", "a".repeat(80), "..%2F"]) {
    const res = await page.request.get(`/ru/projects/${bad}/crew`);
    expect(res.status(), bad).toBe(404);
  }
});
