import { expect, test } from "@playwright/test";
import { NAMES, type E2ERoleKey } from "./fixtures/data";
import { dayId, e2eContext, fetchRsc, projectPath, sniff, storageStatePath } from "./helpers/session";

/**
 * (А) Права разделов: e2e-nocallsheet (без «КПП и вызывные») не видит вызывные и КПП ни в меню,
 * ни по прямому адресу, ни маршрутами листа и Excel. Чужой проект закрыт всем трём ролям.
 */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);

test.describe("без прав на КПП и вызывные", () => {
  test.use({ storageState: storageStatePath("nocallsheet") });

  test("в меню и на «Обзоре» нет «КПП» и «Вызывные»", async ({ page }) => {
    const sniffer = sniff(page);
    await page.goto(projectPath(ctx));
    await expect(page.getByRole("link", { name: "Сцены (либретто)", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "КПП", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Вызывные", exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href*="/call-sheets"]`)).toHaveCount(0);
    await expect(page.locator(`a[href$="/schedule"]`)).toHaveCount(0);
    const rsc = await fetchRsc(page, projectPath(ctx));
    const bodies = [...(await sniffer.done()).map((c) => c.body), rsc.body];
    for (const body of bodies) expect(body).not.toContain(`${ctx.projectId}/call-sheets`);
  });

  for (const [name, path, text] of [
    ["список вызывных", "/call-sheets", "Нет доступа к вызывным"],
    ["вызывной дня 1", `/call-sheets/${day1}`, "Нет доступа к вызывным"],
    ["КПП", "/schedule", "Нет доступа к КПП"],
    ["шаблон вызывного", "/settings/call-sheet-template", /Нет доступа|Недостаточно прав/],
  ] as const) {
    test(`прямой адрес: ${name} — нет доступа и нет данных`, async ({ page }) => {
      const sniffer = sniff(page);
      await page.goto(projectPath(ctx, path));
      await expect(page.getByText(text).first()).toBeVisible();
      const rsc = await fetchRsc(page, projectPath(ctx, path));
      const bodies = [...(await sniffer.done()).map((c) => c.body), rsc.body];
      for (const body of bodies) {
        expect(body).not.toContain(NAMES.transport);
        expect(body).not.toContain("Проверка E2E");
      }
    });
  }

  test("маршруты листа и Excel вызывного — 403", async ({ page }) => {
    await page.goto(projectPath(ctx));
    for (const suffix of ["sheet", "xlsx", "sheet?version=1", "xlsx?version=1"]) {
      const res = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day1}/${suffix}`);
      expect(res.status(), suffix).toBe(403);
      const body = await res.text();
      expect(body).not.toContain(NAMES.transport);
    }
  });
});

test.describe("чужой проект", () => {
  test.skip(!ctx.foreignProjectId, "в базе нет проекта без тестовых пользователей");
  for (const role of ["producer", "nofin", "nocallsheet"] as E2ERoleKey[]) {
    test(`${role}: чужой проект и его вызывной недоступны`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: storageStatePath(role) });
      const page = await context.newPage();
      const foreign = `/ru/projects/${ctx.foreignProjectId}`;
      const res = await page.goto(foreign);
      expect(res?.status()).toBe(404);
      for (const suffix of ["sheet", "xlsx"]) {
        const api = await page.request.get(`/api/projects/${ctx.foreignProjectId}/call-sheets/${day1}/${suffix}`);
        expect([403, 404]).toContain(api.status());
      }
      // Свой день — по адресу чужого проекта: тоже нет.
      const mixed = await page.request.get(`/api/projects/${ctx.foreignProjectId}/call-sheets/${day1}/sheet`);
      expect(await mixed.text()).not.toContain(NAMES.transport);
      await context.close();
    });
  }
});

test("без входа: страницы проекта и маршруты листа не открываются", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await expect(page).toHaveURL(/\/login/);
  const api = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day1}/xlsx`, { maxRedirects: 0 });
  expect(api.status()).not.toBe(200);
  expect(await api.text()).not.toContain(NAMES.transport);
  await context.close();
});
