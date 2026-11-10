import { expect, test, type Page } from "@playwright/test";
import { hasPermission, type Permission } from "../src/features/memberships/permissions";
import { parsePermissionMatrix } from "../src/features/roles/permissions-matrix";
import { ROLE_PRESETS } from "../src/features/roles/role-presets";
import { CREW, E2E_ROLE_NAMES, E2E_ROLES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Шаблоны ролей, шаг 5: каждая роль из шаблона видит и не видит то, что положено, — по ответу
 * сервера. Участник «только команда» по очереди получает в приёмочном проекте каждую шаблонную
 * роль (их добавила миграция). Проверяется: какие разделы открыты, а в ответах — контакты команды,
 * телефон кандидата кастинга, суммы договоров. Ожидание считается из прав шаблона в коде;
 * совпадение самих прав с решениями владельца проверяет role-presets.test.ts.
 * В конце роль участника возвращается прежней.
 */

const ctx = e2eContext();
const db = e2eDb();
const CANDIDATE_PHONE = "+7 900 000-00-03";
const compact = (s: string) => s.replace(/[\s  ]/g, "");

type Route = { path: string; denied: string; open: (can: (p: Permission) => boolean) => boolean };

const ROUTES: Route[] = [
  { path: "/screenplay", denied: "Нет доступа к сценарию", open: (c) => c("screenplay:read") },
  { path: "/libretto", denied: "Нет доступа к сценам", open: (c) => c("scenes:read") },
  { path: "/locations", denied: "Нет доступа к объектам", open: (c) => c("locations:read") },
  { path: "/characters", denied: "Нет доступа", open: (c) => c("characters:read") },
  { path: "/preproduction/casting", denied: "Нет доступа", open: (c) => c("cast:read") },
  { path: "/schedule", denied: "Нет доступа к КПП", open: (c) => c("schedule:read") },
  { path: "/call-sheets", denied: "Нет доступа к вызывным", open: (c) => c("callsheet:read") || c("schedule:read") },
  { path: "/reports", denied: "Нет доступа к отчётам", open: (c) => c("report:read") || c("schedule:read") },
  { path: "/crew", denied: "Нет доступа к команде", open: (c) => c("crew:read") },
  { path: "/preproduction/calendar", denied: "Нет доступа", open: (c) => c("calendar:read") },
  { path: "/settings/resources", denied: "Нет доступа", open: (c) => c("resources:read") },
  { path: "/finance", denied: "Нет доступа к финансам", open: (c) => c("finance:read") },
  { path: "/counterparties/contracts", denied: "Нет доступа к договорам", open: (c) => c("contracts:read") },
  { path: "/members", denied: "Нет доступа", open: (c) => c("members:read") },
  { path: "/post", denied: "Нет доступа к постпродакшну", open: (c) => c("post:read") },
];

let membershipId = "";
let originalRoleId = "";
let isHead = false;

async function body(page: Page, rest: string) {
  const res = await page.request.get(projectPath(ctx, rest));
  expect(res.status(), rest).toBeLessThan(500);
  return compact(await res.text());
}

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStatePath("crewonly") });

test.beforeAll(async () => {
  // Участие ищется по человеку, а прежняя роль — по названию: прогон, оборванный до afterAll,
  // оставил бы участника на шаблонной роли — здесь он возвращается на свою.
  const [user, role] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: E2E_ROLES.crewonly.email }, select: { id: true } }),
    db.projectRoleDefinition.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: E2E_ROLE_NAMES.crewonly },
      select: { id: true },
    }),
  ]);
  const membership = await db.projectMembership.findUniqueOrThrow({
    where: { projectId_userId: { projectId: ctx.projectId, userId: user.id } },
    select: { id: true, departmentHeads: { select: { id: true } } },
  });
  membershipId = membership.id;
  originalRoleId = role.id;
  isHead = membership.departmentHeads.length > 0;
  await db.projectMembership.update({ where: { id: membershipId }, data: { roleId: originalRoleId } });
});

test.afterAll(async () => {
  if (membershipId) {
    await db.projectMembership.update({ where: { id: membershipId }, data: { roleId: originalRoleId } });
  }
});

test("шаблоны в приёмочном проекте: все девять, без дублей и подмены прежних ролей", async () => {
  const roles = await db.projectRoleDefinition.findMany({
    where: { projectId: ctx.projectId },
    select: { name: true, isSystem: true, presetKey: true, _count: { select: { memberships: true } } },
  });
  const norm = (s: string) => s.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  const names = roles.map((r) => norm(r.name));
  expect(new Set(names).size).toBe(names.length);
  expect(roles.filter((r) => r.presetKey).map((r) => r.presetKey).sort()).toEqual(ROLE_PRESETS.map((p) => p.key).sort());
  // Шаблонные роли не системные и свежие — участников у них нет (их никто не получал).
  for (const r of roles.filter((x) => x.presetKey)) {
    expect(r.isSystem).toBe(false);
    expect(r._count.memberships).toBe(0);
  }
  // Прежние роли проекта на месте и со своими участниками.
  for (const name of ["Продюсер", "Наблюдатель", E2E_ROLE_NAMES.nofin, E2E_ROLE_NAMES.crewonly]) {
    const r = roles.find((x) => x.name === name);
    expect(r, name).toBeTruthy();
    expect(r!.presetKey).toBeNull();
  }
});

for (const preset of ROLE_PRESETS) {
  test(`«${preset.name}»: открытые и закрытые разделы, контакты, телефоны кандидатов, суммы`, async ({ page }) => {
    const role = await db.projectRoleDefinition.findFirstOrThrow({
      where: { projectId: ctx.projectId, presetKey: preset.key },
      select: { id: true, permissions: true },
    });
    await db.projectMembership.update({ where: { id: membershipId }, data: { roleId: role.id } });
    const matrix = parsePermissionMatrix(role.permissions);
    const can = (p: Permission) => hasPermission(matrix, p);

    for (const route of ROUTES) {
      await page.goto(projectPath(ctx, route.path));
      const denial = page.getByText(route.denied, { exact: true });
      if (route.open(can)) {
        await expect(denial, `${preset.key} ${route.path} открыт`).toHaveCount(0);
      } else {
        await expect(denial, `${preset.key} ${route.path} закрыт`).toBeVisible();
      }
    }

    // Сметы: все — «просмотр всех», своя — только главе цеха (участник здесь не глава).
    await page.goto(projectPath(ctx, "/smeta"));
    const smetaDenied = page.getByText("Нет доступа к сметам", { exact: true });
    if (can("smeta:read_all") || isHead) await expect(smetaDenied).toHaveCount(0);
    else await expect(smetaDenied).toBeVisible();

    // Контакты команды — только с «Команда: контакты».
    const crew = await body(page, "/crew");
    expect(crew.includes(compact(CREW.linked.phone)), `${preset.key}: телефон команды`).toBe(can("crew:contacts"));

    // Телефон кандидата — только с «Актёры» (кастинг); «Персонажи» его не отдают.
    for (const rest of ["/preproduction/casting", "/characters"]) {
      const html = await body(page, rest);
      expect(html.includes(compact(CANDIDATE_PHONE)), `${preset.key} ${rest}: телефон кандидата`).toBe(can("cast:read") && rest === "/preproduction/casting");
    }

    // Суммы договоров — только с договорами и просмотром финансов.
    const contracts = await body(page, "/counterparties/contracts");
    const amount = [CREW.contractAmount, CREW.contractAmount.replace(".", ",")].some((a) => contracts.includes(a));
    expect(amount, `${preset.key}: сумма договора`).toBe(can("contracts:read") && can("finance:read"));
  });
}
