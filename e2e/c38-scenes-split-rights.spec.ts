import { Prisma } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ROLE_NAMES, NAMES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Шаблоны ролей, шаг 1: раздел «Сцены» разделён на «Сценарий», «Сцены (либретто)», «Объекты и
 * места», «Ресурсы», «Персонажи». Роль «без кастинга» получает по одному разделу, и по ответу
 * сервера проверяется: свой раздел открыт, чужие — нет; «Персонажи» без «Актёров» не отдают
 * кандидатов и их телефоны.
 */

const ctx = e2eContext();
const db = e2eDb();
const CANDIDATE_PHONE = "+7 900 000-00-03";

type Section = { access: boolean; read: boolean; create: boolean; update: boolean; delete: boolean };
const OFF: Section = { access: false, read: false, create: false, update: false, delete: false };
const READ: Section = { ...OFF, access: true, read: true };
const SPLIT = ["screenplay", "scenes", "locations", "elements", "characters", "actors"] as const;

let roleId = "";
let original: Prisma.JsonValue = null;

/** Права роли «без кастинга»: из разделов бывших «Сцен» и «Актёров» включены только указанные. */
async function grantOnly(sections: Partial<Record<(typeof SPLIT)[number], Section>>) {
  const base = original as Record<string, Record<string, boolean>>;
  const next: Record<string, unknown> = { ...base };
  for (const id of SPLIT) next[id] = { ...base[id], ...OFF, financeRead: false, financeWrite: false, ...sections[id] };
  await db.projectRoleDefinition.update({ where: { id: roleId }, data: { permissions: next as Prisma.InputJsonValue } });
}

/** HTML страницы целиком — вместе с данными для браузера. */
async function html(page: Page, rest: string) {
  const res = await page.request.get(projectPath(ctx, rest));
  expect(res.status()).toBeLessThan(500);
  return res.text();
}

async function opensWith(page: Page, rest: string, text: string) {
  await page.goto(projectPath(ctx, rest));
  await expect(page.getByText(text).first()).toBeVisible();
}

async function denied(page: Page, rest: string, message: string) {
  await page.goto(projectPath(ctx, rest));
  await expect(page.getByText(message, { exact: true })).toBeVisible();
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStatePath("nocast") });

test.beforeAll(async () => {
  const role = await db.projectRoleDefinition.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: E2E_ROLE_NAMES.nocast },
    select: { id: true, permissions: true },
  });
  roleId = role.id;
  original = role.permissions;
});

test.afterAll(async () => {
  if (roleId) {
    await db.projectRoleDefinition.update({
      where: { id: roleId },
      data: { permissions: original as Prisma.InputJsonValue },
    });
  }
});

test("только «Персонажи»: персонажи видны, кастинг, телефоны кандидатов и другие разделы — нет", async ({ page }) => {
  await grantOnly({ characters: READ });
  const ivan = await db.character.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: NAMES.character },
    select: { id: true },
  });

  await opensWith(page, "/characters", NAMES.character);
  await opensWith(page, `/characters/${ivan.id}`, NAMES.character);
  await expect(page.getByText("Кандидаты на роль")).toHaveCount(0);
  for (const rest of ["/characters", `/characters/${ivan.id}`]) {
    const body = await html(page, rest);
    expect(body).toContain(NAMES.character);
    expect(body).not.toContain(NAMES.castingPerson.lastName);
    expect(body).not.toContain(CANDIDATE_PHONE);
  }
  // Список не отдаёт записи кандидатов и актёров вовсе: ни заметок, ни оценок, ни счётчиков.
  const list = await html(page, "/characters");
  for (const key of ["castingCandidates", "_count", "rating"]) {
    expect(list).not.toContain(`\\"${key}\\"`);
    expect(list).not.toContain(`"${key}"`);
  }

  await denied(page, "/preproduction/casting", "Нет доступа");
  await denied(page, "/screenplay", "Нет доступа к сценарию");
  await denied(page, "/libretto", "Нет доступа к сценам");
  await denied(page, "/locations", "Нет доступа к объектам");
  await denied(page, "/settings/resources", "Нет доступа");
  // «Файлы» здесь открыты: у роли есть просмотр настроек проекта (project:read) — так было и раньше.
});

test("«Персонажи: правка» без «Актёров»: персонажа без кандидатов удалить можно, с кандидатами — нет", async ({ page }) => {
  await grantOnly({ characters: { ...READ, create: true, update: true, delete: true } });
  const temp = await db.character.create({
    data: { projectId: ctx.projectId, name: `Временный ${Date.now().toString(36)}` },
    select: { id: true, name: true },
  });
  const ivan = await db.character.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: NAMES.character },
    select: { id: true },
  });
  try {
    await page.goto(projectPath(ctx, "/characters"));
    // Иван: окно предупреждает, что кандидаты удалятся и нужно право на «Актёров».
    await page.locator("tr", { hasText: NAMES.character }).first().getByRole("button", { name: "×" }).click();
    const ivanDialog = page.getByRole("dialog");
    await expect(ivanDialog).toContainText("Удалятся кандидаты кастинга на эту роль: 1");
    await expect(ivanDialog).toContainText("правит «Актёров»");
    await ivanDialog.getByRole("button", { name: "Отмена" }).click();

    // Временный без кандидатов удаляется; id действия — для подделанного запроса.
    await page.locator("tr", { hasText: temp.name }).getByRole("button", { name: "×" }).click();
    const dialog = page.getByRole("dialog");
    const request = page.waitForRequest((r) => Boolean(r.headers()["next-action"]) && r.postData()?.includes(temp.id) === true);
    await dialog.getByRole("button", { name: "Удалить" }).click();
    const deleteId = (await request).headers()["next-action"]!;
    await expect.poll(async () => db.character.count({ where: { id: temp.id } })).toBe(0);

    const forged = await page.request.post(projectPath(ctx, "/characters"), {
      headers: {
        "next-action": deleteId,
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        origin: new URL(page.url()).origin,
      },
      data: JSON.stringify([ctx.projectId, ivan.id]),
    });
    expect(await forged.text()).toContain("правит «Актёров»");
    expect(await db.character.count({ where: { id: ivan.id } })).toBe(1);
    expect(await db.castingCandidate.count({ where: { characterId: ivan.id } })).toBeGreaterThan(0);
  } finally {
    await db.character.deleteMany({ where: { id: temp.id } });
  }
});

test("«Персонажи» вместе с «Актёрами» — кандидат и телефон на карточке есть (проверка не пустая)", async ({ page }) => {
  await grantOnly({ characters: READ, actors: READ });
  const ivan = await db.character.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: NAMES.character },
    select: { id: true },
  });
  await opensWith(page, `/characters/${ivan.id}`, "Кандидаты на роль");
  const body = await html(page, `/characters/${ivan.id}`);
  expect(body).toContain(NAMES.castingPerson.lastName);
  expect(body).toContain(CANDIDATE_PHONE);
});

test("только «Объекты и места»: объекты и скаут, без сценария, либретто и персонажей", async ({ page }) => {
  await grantOnly({ locations: READ });
  await opensWith(page, "/locations", NAMES.location);
  await opensWith(page, "/preproduction/scout", NAMES.scout);
  await denied(page, "/screenplay", "Нет доступа к сценарию");
  await denied(page, "/libretto", "Нет доступа к сценам");
  await denied(page, "/characters", "Нет доступа");
  await denied(page, "/settings/resources", "Нет доступа");
});

test("только «Сценарий»: сценарий и файлы, без либретто и объектов", async ({ page }) => {
  await grantOnly({ screenplay: READ });
  await page.goto(projectPath(ctx, "/screenplay"));
  await expect(page.getByText("Нет доступа к сценарию")).toHaveCount(0);
  await page.goto(projectPath(ctx, "/files"));
  await expect(page.getByText("Нет доступа к файлам")).toHaveCount(0);
  await denied(page, "/libretto", "Нет доступа к сценам");
  await denied(page, "/locations", "Нет доступа к объектам");
  const body = await html(page, "/screenplay");
  expect(body).not.toContain(NAMES.location);
});

test("только «Сцены (либретто)»: либретто, без сценария и объектов", async ({ page }) => {
  await grantOnly({ scenes: READ });
  await page.goto(projectPath(ctx, "/libretto"));
  await expect(page.getByText("Нет доступа к сценам")).toHaveCount(0);
  await denied(page, "/screenplay", "Нет доступа к сценарию");
  await denied(page, "/locations", "Нет доступа к объектам");
  await denied(page, "/preproduction/scout", "Нет доступа");
});

test("только «Ресурсы»: ресурсы, без либретто и объектов", async ({ page }) => {
  await grantOnly({ elements: READ });
  await page.goto(projectPath(ctx, "/settings/resources"));
  await expect(page.getByText("Нет доступа", { exact: true })).toHaveCount(0);
  await denied(page, "/libretto", "Нет доступа к сценам");
  await denied(page, "/locations", "Нет доступа к объектам");
  await denied(page, "/screenplay", "Нет доступа к сценарию");
});
