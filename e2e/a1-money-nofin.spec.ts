import { expect, test, type Page } from "@playwright/test";
import { NAMES } from "./fixtures/data";
import { findLeaks, mentionedMoneyFields, workbookText, type Leak } from "./helpers/leaks";
import { dayId, downloadBuffer, e2eContext, fetchRsc, projectPath, sniff, storageStatePath } from "./helpers/session";

/**
 * (А) Деньги: роль e2e-nofin (без «Финансов» и фин. условий, с «КПП и вызывные: правка»)
 * не получает ставок ни в HTML, ни в `?_rsc`, ни в ответах действий, ни в Excel и печати.
 * Ищем известные суммы тестового проекта и имена денежных полей.
 */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);

test.use({ storageState: storageStatePath("nofin") });

function expectNoLeaks(leaks: Leak[]) {
  expect(leaks, leaks.map((l) => `${l.where}: ${l.what} … ${l.around}`).join("\n")).toEqual([]);
}

/** Страница: документ, RSC-ответ того же адреса и всё, что сайт отдал, пока она открыта. */
async function scanPage(page: Page, path: string, marker: string | RegExp) {
  const sniffer = sniff(page);
  await page.goto(path);
  await expect(page.getByText(marker).first()).toBeVisible();
  // Дождаться запросов после загрузки (серверные действия, iframe листа).
  await page.waitForLoadState("networkidle");
  const rsc = await fetchRsc(page, path);
  expect(rsc.status).toBe(200);
  expect(rsc.type).toContain("text/x-component");
  const captured = await sniffer.done();
  const leaks = [
    ...captured.flatMap((c) => findLeaks(`${c.type} ${c.url}`, c.body)),
    ...findLeaks(`?_rsc ${path}`, rsc.body),
  ];
  // Поля без значения (`"kmRate":""`) — не утечка, но в отчёт.
  const empty = new Set([...captured.map((c) => c.body), rsc.body].flatMap(mentionedMoneyFields));
  if (empty.size > 0) {
    test.info().annotations.push({ type: "денежные поля без значения", description: [...empty].join(", ") });
  }
  return { leaks, captured };
}

const PAGES: { name: string; path: string; marker: string | RegExp }[] = [
  { name: "вызывной дня 1", path: projectPath(ctx, `/call-sheets/${day1}`), marker: NAMES.transport },
  { name: "список вызывных", path: projectPath(ctx, "/call-sheets"), marker: /День 1/ },
  { name: "КПП", path: projectPath(ctx, "/schedule"), marker: "КПП и вызывные" },
  { name: "отчёт смены дня 1", path: projectPath(ctx, `/reports/${day1}`), marker: NAMES.actor.lastName },
  { name: "кастинг", path: projectPath(ctx, "/preproduction/casting"), marker: NAMES.castingPerson.lastName },
  { name: "смета (нет доступа)", path: projectPath(ctx, "/smeta"), marker: "Нет доступа к сметам" },
  { name: "актёры и персонажи", path: projectPath(ctx, "/actors"), marker: NAMES.character },
  { name: "локации", path: projectPath(ctx, "/locations"), marker: NAMES.location },
  { name: "ресурсы", path: projectPath(ctx, "/resources"), marker: /Игровой транспорт/ },
  { name: "либретто", path: projectPath(ctx, "/libretto"), marker: "Показано 3 из 3 сцен" },
  { name: "обзор проекта", path: projectPath(ctx), marker: "Обзор проекта" },
  { name: "карточка сцены", path: projectPath(ctx, `/libretto/${ctx.sceneId}`), marker: "Сцена 1" },
  { name: "карточка объекта", path: projectPath(ctx, `/locations/${ctx.locationId}`), marker: NAMES.location },
  { name: "карточка персонажа (актёр)", path: projectPath(ctx, `/characters/${ctx.characterId}`), marker: "Требования к роли" },
  { name: "карточка кастинга", path: projectPath(ctx, `/preproduction/casting/${ctx.castingPersonId}`), marker: NAMES.castingPerson.lastName },
  {
    name: "позиция ресурса",
    path: projectPath(ctx, `/settings/resources/${ctx.vehicle.categoryId}/items/${ctx.vehicle.itemId}`),
    marker: NAMES.vehicle,
  },
  { name: "занятость ресурсов", path: projectPath(ctx, "/resource-usage"), marker: /./ },
  { name: "журнал изменений", path: projectPath(ctx, "/audit"), marker: /Журнал/ },
  { name: "производственные отчёты", path: projectPath(ctx, "/reports"), marker: /День 1|1/ },
];

for (const p of PAGES) {
  test(`без финансов — ${p.name}: нет ставок в HTML, ?_rsc и ответах`, async ({ page }) => {
    const { leaks } = await scanPage(page, p.path, p.marker);
    expectNoLeaks(leaks);
  });
}

test("без финансов — переход по меню (?_rsc при навигации) без ставок", async ({ page }) => {
  const sniffer = sniff(page);
  await page.goto(projectPath(ctx));
  for (const [group, label] of [
    [null, "КПП"],
    [null, "Вызывные"],
    [null, "Локации"],
    ["Отчёты", "Производственные отчёты"],
    ["Препродакшн", "Кастинг"],
  ] as const) {
    const link = page.getByRole("link", { name: label, exact: true }).first();
    if (group) {
      const toggle = page.getByRole("button", { name: group, exact: true }).first();
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    }
    await link.click();
    await page.waitForLoadState("networkidle");
  }
  const captured = await sniffer.done();
  expect(captured.some((c) => c.type.startsWith("text/x-component")), "были ответы RSC").toBe(true);
  expectNoLeaks(captured.flatMap((c) => findLeaks(`${c.type} ${c.url}`, c.body)));
});

test("без финансов — финансы, начисления, платежи, смета цеха: нет доступа", async ({ page }) => {
  for (const [path, text] of [
    ["/finance", "Нет доступа к финансам"],
    ["/accruals", "Нет доступа к финансам"],
    ["/payments", "Нет доступа к финансам"],
    ["/accruals/shift-entry", "Нет доступа к финансам"],
  ] as const) {
    const { leaks } = await scanPage(page, projectPath(ctx, path), text);
    expectNoLeaks(leaks);
  }
  // Смета цеха по прямому адресу.
  const sniffer = sniff(page);
  const res = await page.goto(projectPath(ctx, `/smeta/${ctx.departmentId}`));
  expect([200, 404]).toContain(res?.status());
  await expect(page.getByText("Спецтехника")).toHaveCount(0);
  expectNoLeaks((await sniffer.done()).flatMap((c) => findLeaks(c.url, c.body)));
});

test("без финансов — лист вызывного маршрутом и Excel вызывного без ставок", async ({ page }) => {
  await page.goto(projectPath(ctx));
  const sheet = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day1}/sheet`);
  expect(sheet.status()).toBe(200);
  const sheetHtml = await sheet.text();
  expect(sheetHtml).toContain(NAMES.transport);
  expectNoLeaks(findLeaks("sheet", sheetHtml));

  const xlsx = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day1}/xlsx`);
  expect(xlsx.status()).toBe(200);
  const text = await workbookText(await xlsx.body());
  expect(text).toContain(NAMES.transport);
  expectNoLeaks(findLeaks("call-sheet.xlsx", text));
});

test("без финансов — «Печать / PDF»: окно открывается, в листе нет ставок", async ({ page }) => {
  const sniffer = sniff(page);
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Печать / PDF" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText(NAMES.transport).first()).toBeVisible();
  const html = await popup.content();
  expect(html).toContain('font-family:"Medeo Sans"');
  expectNoLeaks(findLeaks("окно печати", html));
  expectNoLeaks((await sniffer.done()).flatMap((c) => findLeaks(c.url, c.body)));
  await popup.close();
});

test("без финансов — явочный лист Excel без ставок", async ({ page }) => {
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await page.getByRole("button", { name: "Экспорт ▾" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("group", { name: "Явочный лист" }).getByRole("menuitem", { name: "Excel" }).click();
  const download = await downloadPromise;
  const text = await workbookText(await downloadBuffer(download));
  expect(text).toContain(NAMES.actor.lastName);
  expectNoLeaks(findLeaks(`явочный ${download.suggestedFilename()}`, text));
});

test("без финансов — выгрузка КПП в Excel без ставок (и ответ действия тоже)", async ({ page }) => {
  const sniffer = sniff(page);
  await page.goto(projectPath(ctx, "/schedule"));
  for (const mode of ["Полный КПП", "Краткий КПП"]) {
    await page.getByRole("button", { name: "Экспорт", exact: true }).click();
    await page.getByRole("button", { name: mode }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Экспортировать Excel" }).click();
    const download = await downloadPromise;
    const text = await workbookText(await downloadBuffer(download));
    expect(text).toMatch(/Утро в квартире|Квартира Ивановых|Тестов/);
    expectNoLeaks(findLeaks(`${mode} ${download.suggestedFilename()}`, text));
    await page.keyboard.press("Escape");
  }
  expectNoLeaks((await sniffer.done()).flatMap((c) => findLeaks(c.url, c.body)));
});

test("без финансов — утверждённые версии дня 2 (лист и Excel из снимка) без ставок", async ({ page }) => {
  const day2 = dayId(ctx, 2);
  await page.goto(projectPath(ctx));
  // Версии появляются после сценария утверждения (c1-flows); до первого прогона их может не быть.
  for (const version of [1, 2, 3]) {
    const sheet = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day2}/sheet?version=${version}`);
    if (sheet.status() === 404) continue;
    expect(sheet.status()).toBe(200);
    expectNoLeaks(findLeaks(`sheet v${version}`, await sheet.text()));
    const xlsx = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day2}/xlsx?version=${version}`);
    expect(xlsx.status()).toBe(200);
    expectNoLeaks(findLeaks(`xlsx v${version}`, await workbookText(await xlsx.body())));
  }
});
