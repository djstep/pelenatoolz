import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 5 (дизайн): скриншоты экранов в обеих темах и проверка контраста текста.
 * Запускается только с `DESIGN_SHOTS=<папка>` (иначе пропускается и в `npm run e2e` не мешает):
 *   DESIGN_SHOTS=step1 npx playwright test e2e/d3-design-screens.spec.ts
 * Снимки — в `docs/tasks/ref/design/out/<папка>/`, там же `contrast.json` (текст с контрастом
 * ниже 4.5:1, крупный — ниже 3:1) и `console-errors.json`.
 */

const SHOTS = process.env.DESIGN_SHOTS ?? "";
const OUT = path.join(__dirname, "..", "docs", "tasks", "ref", "design", "out", SHOTS || "_");

/** `fit` — экран на всю высоту окна со своей прокруткой: main не раскрываем (доска, редакторы). */
type Screen = { name: string; path: string; fit?: boolean };

function screens(): Screen[] {
  const ctx = e2eContext();
  return [
    { name: "projects", path: "/ru/projects" },
    { name: "overview", path: projectPath(ctx) },
    { name: "libretto", path: projectPath(ctx, "/libretto") },
    { name: "scene-card", path: projectPath(ctx, `/libretto/${ctx.sceneId}`) },
    { name: "kpp", path: projectPath(ctx, "/schedule") },
    { name: "smeta-department", path: projectPath(ctx, `/smeta/${ctx.smetaDepartmentId ?? ctx.departmentId}`) },
  ];
}

type ContrastIssue = { text: string; color: string; background: string; ratio: number; need: number };

/** Текст на странице с недостаточным контрастом (фон — ближайшие непрозрачные слои под текстом). */
async function contrastIssues(page: Page): Promise<ContrastIssue[]> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = "rgba(0,0,0,0)";
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], under: number[]) => {
      const a = top[3];
      return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const bgOf = (el: Element | null): number[] => {
      const layers: number[][] = [];
      for (let n = el; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let acc = [255, 255, 255, 1];
      if (layers.length && layers[layers.length - 1][3] >= 1) acc = layers.pop()!;
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    const issues: ContrastIssue[] = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const text = (t.textContent ?? "").trim();
      const el = t.parentElement;
      if (!text || !el) continue;
      if (el.closest("script,style,noscript,[aria-hidden='true'],.univer-smeta-host,.sr-only")) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Отключённые элементы (disabled) правилом контраста не проверяются.
      if (el.closest(":disabled,[aria-disabled='true']")) continue;
      const bg = bgOf(el);
      const fg = over(rgba(cs.color), bg);
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio + 0.005 >= need) continue;
      const key = `${cs.color}|${bg.join(",")}|${text.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        text: text.slice(0, 60),
        color: cs.color,
        background: `rgb(${bg.slice(0, 3).map(Math.round).join(", ")})`,
        ratio: Math.round(ratio * 100) / 100,
        need,
      });
    }
    return issues;
  });
}

/**
 * Базовые элементы (шаг 2): открытые списки, календарь, окно с формой, подтверждение,
 * «несохранённые изменения», тосты. Только с `DESIGN_COMPONENTS=1`. Данные не меняются:
 * успех — «Сохранить» карточки сцены без правок, ошибка — номер уже существующей сцены.
 */
test.describe("design components", () => {
  test.skip(!SHOTS || !process.env.DESIGN_COMPONENTS, "только с DESIGN_SHOTS и DESIGN_COMPONENTS=1");
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 1280, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`components ${theme}`, async ({ page }) => {
      test.setTimeout(300_000);
      mkdirSync(OUT, { recursive: true });
      const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });
      await page.addInitScript((t) => window.localStorage.setItem("filmprod-theme", t), theme);
      page.on("dialog", (d) => void d.accept());
      const ctx = e2eContext();
      const main = page.locator("main");

      // Карточка сцены целиком и выпадающие списки.
      await page.goto(projectPath(ctx, `/libretto/${ctx.sceneId}`));
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: path.join(OUT, `scene-card-full-${theme}.png`), fullPage: true });
      await main.getByRole("button", { name: "Инт", exact: true }).click();
      await shot("select-open");
      await page.keyboard.press("Escape");
      await main.getByRole("button", { name: "Квартира Ивановых" }).click();
      await shot("creatable-open");
      await page.keyboard.press("Escape");
      await main.getByPlaceholder("Поиск персонажа…").fill("Ив");
      await shot("autocomplete-open");
      await main.getByPlaceholder("Поиск персонажа…").fill("");

      // Подтверждение (опасное действие) — «Отмена».
      await main.getByRole("button", { name: "Вырезать сцену" }).click();
      await page.getByRole("dialog").waitFor();
      await shot("confirm");
      await page.getByRole("dialog").getByRole("button", { name: "Отмена" }).click();


      // «Несохранённые изменения» — «Не сохранять».
      await main.locator("textarea[name=summary]").fill("ТЕСТ волна 5");
      await page.getByRole("link", { name: "Объекты", exact: true }).first().click();
      await page.getByRole("alertdialog").waitFor();
      await shot("unsaved");
      await page.getByRole("alertdialog").getByRole("button", { name: "Не сохранять" }).click();
      await page.waitForURL(/\/locations/);

      // Окно с формой.
      await page.goto(projectPath(ctx, "/libretto"));
      await page.waitForLoadState("networkidle");
      await main.getByRole("button", { name: "+ Добавить сцену" }).click();
      await page.getByRole("dialog").waitFor();
      await shot("modal-form");
      await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).first().click();

      // Тост успеха: карточка кандидата кастинга — «Сохранить» без правок (те же значения).
      await page.goto(projectPath(ctx, `/preproduction/casting/${ctx.castingPersonId}`));
      await page.waitForLoadState("networkidle");
      await main.getByRole("button", { name: "Редактировать" }).first().click();
      await main.getByRole("button", { name: "Сохранить", exact: true }).first().click();
      await page.locator(".toast-item[role=status]").first().waitFor();
      await shot("toast-success");

      // Тост ошибки: новая роль с названием существующей — сервер отказывает, ничего не пишется.
      await page.goto(projectPath(ctx, "/roles"));
      await page.waitForLoadState("networkidle");
      await main.getByRole("button", { name: "+ Добавить роль" }).click();
      await page.getByRole("dialog").locator("input[name=name]").fill("Продюсер");
      await page.getByRole("dialog").getByRole("button", { name: "Сохранить" }).click();
      await page.locator(".toast-item[role=alert]").first().waitFor();
      await shot("toast-error");
      await page.getByRole("dialog").getByRole("button", { name: "Закрыть" }).first().click();
      const unsaved = page.getByRole("alertdialog");
      if (await unsaved.isVisible().catch(() => false)) {
        await unsaved.getByRole("button", { name: "Не сохранять" }).click();
      }

      // Календарь (дата) и время — форма дня на КПП.
      await page.goto(projectPath(ctx, "/schedule"));
      await page.waitForLoadState("networkidle");
      await main.getByRole("button", { name: /^с$/ }).first().click();
      await shot("date-open");
      await page.keyboard.press("Escape");
    });
  }
});

/**
 * Сверка с эскизом: эскиз `docs/tasks/ref/design/<эскиз>-<тема>.png` (2880×1800 = 1440×900 @2x)
 * и наша страница на 1440×900 — рядом в одном масштабе, плюс наш снимок отдельно.
 * `DESIGN_COMPARE=scenes` (шаг 3, страница сцен) или `kpp` (шаг 4; адрес проекта —
 * `DESIGN_COMPARE_PROJECT`, иначе «E2E приёмка»).
 */
const COMPARE: Record<string, { title: string; path: () => string }> = {
  scenes: { title: "Наша страница сцен (либретто)", path: () => projectPath(e2eContext(), "/libretto") },
  smeta: {
    title: "Наша смета цеха",
    path: () => {
      const ctx = e2eContext();
      return projectPath(ctx, `/smeta/${ctx.smetaDepartmentId ?? ctx.departmentId}`);
    },
  },
  kpp: {
    title: "Наш КПП",
    path: () =>
      process.env.DESIGN_COMPARE_PROJECT
        ? `/ru/projects/${process.env.DESIGN_COMPARE_PROJECT}/schedule`
        : projectPath(e2eContext(), "/schedule"),
  },
};

test.describe("design compare", () => {
  const which = process.env.DESIGN_COMPARE ?? "";
  test.skip(!SHOTS || !COMPARE[which], "только с DESIGN_SHOTS и DESIGN_COMPARE=scenes|kpp|smeta");
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`compare ${which} ${theme}`, async ({ page }) => {
      mkdirSync(OUT, { recursive: true });
      const target = COMPARE[which];
      await page.addInitScript((t) => window.localStorage.setItem("filmprod-theme", t), theme);
      await page.goto(target.path());
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // Эскиз сметы — в полноэкранном режиме; холст дорисовывается после загрузки.
      if (which === "smeta") {
        await page.waitForSelector(".univer-smeta-host canvas");
        await page.getByRole("button", { name: "На весь экран" }).click();
        await page.waitForTimeout(3000);
      }
      const ours = await page.screenshot();
      writeFileSync(path.join(OUT, `compare-${which}-${theme}-ours.png`), ours);

      const sketchPath = path.join(__dirname, "..", "docs", "tasks", "ref", "design", `${which}-${theme}.png`);
      if (!existsSync(sketchPath)) return; // Эскиза этой темы нет — только наш снимок.
      const sketch = readFileSync(sketchPath);
      await page.setViewportSize({ width: 2904, height: 948 });
      await page.setContent(
        `<body style="margin:0;background:#888;font:600 16px sans-serif;color:#fff">
          <div style="display:flex;gap:24px">
            <figure style="margin:0"><figcaption style="height:48px;line-height:48px;padding-left:8px">Эскиз ${which}-${theme}.png</figcaption>
              <img src="data:image/png;base64,${sketch.toString("base64")}" style="width:1440px;height:900px;display:block"></figure>
            <figure style="margin:0"><figcaption style="height:48px;line-height:48px;padding-left:8px">${target.title}, 1440×900</figcaption>
              <img src="data:image/png;base64,${ours.toString("base64")}" style="width:1440px;height:900px;display:block"></figure>
          </div></body>`,
      );
      await page.screenshot({ path: path.join(OUT, `compare-${which}-${theme}.png`), fullPage: true });
    });
  }
});

/** Экраны пачек шага 5 (`DESIGN_PACK=1..7`): адреса «E2E приёмка» по карте экранов. */
function packScreens(pack: string): Screen[] {
  const ctx = e2eContext();
  const p = (name: string, rest: string): Screen => ({ name, path: projectPath(ctx, rest) });
  const day1 = ctx.days.find((d) => d.dayNumber === 1)?.id ?? "";
  const lists: Record<string, Screen[]> = {
    "1": [
      p("overview", ""),
      p("members", "/members"),
      p("roles", "/roles"),
      p("settings", "/settings"),
      p("departments", "/settings/departments"),
      p("callsheet-template", "/settings/call-sheet-template"),
      p("resources", "/settings/resources"),
      p("resource-category", `/settings/resources/${ctx.vehicle.categoryId}`),
      p("resource-item", `/settings/resources/${ctx.vehicle.categoryId}/items/${ctx.vehicle.itemId}`),
      p("audit", "/audit"),
      { name: "profile", path: "/ru/profile" },
      { name: "projects-new", path: "/ru/projects/new" },
    ],
    "2": [
      p("screenplay", "/screenplay"),
      p("screenplay-version", `/screenplay/${ctx.scriptVersionId}`),
      p("screenplay-sync", `/screenplay/${ctx.scriptVersionId}/sync`),
      p("screenplay-compare", `/screenplay/compare?a=${ctx.scriptVersionId}&b=${ctx.scriptVersionId}`),
      p("dictionary", "/screenplay/dictionary"),
      p("import", "/screenplay/import"),
    ],
    "3": [
      p("libretto", "/libretto"),
      p("scene", `/libretto/${ctx.sceneId}`),
      p("locations", "/locations"),
      p("location", `/locations/${ctx.locationId}`),
      p("characters", "/characters"),
      p("character", `/characters/${ctx.characterId}`),
      p("employment", `/characters/employment/${day1}`),
      p("availability", "/schedule/availability"),
    ],
    "4": [
      p("casting", "/preproduction/casting"),
      p("casting-person", `/preproduction/casting/${ctx.castingPersonId}`),
      p("auditions", "/preproduction/auditions"),
      p("scout", "/preproduction/scout"),
    ],
    "5": [
      p("call-sheets", "/call-sheets"),
      p("call-sheet", `/call-sheets/${day1}`),
      p("reports", "/reports"),
      p("report", `/reports/${day1}`),
    ],
    "6": [
      p("accruals", "/accruals"),
      p("shift-entry", "/accruals/shift-entry"),
      p("payments", "/payments"),
      p("finance", "/finance"),
      p("finance-reports", "/finance/reports"),
      p("finance-settings", "/finance/settings"),
      p("counterparties", "/counterparties"),
      p("contracts", "/counterparties/contracts"),
      p("acts", "/counterparties/acts"),
      p("ledger", "/resource-usage"),
      p("smeta-list", "/smeta"),
      p("smeta-summary", "/smeta/summary"),
      p("plan-fact", "/smeta/plan-fact"),
    ],
    "7": [p("post", "/post"), p("files", "/files")],
  };
  return lists[pack] ?? [];
}

/** Все экраны карты шага 0 (волна 5, шаг 7): пачки + карточки из сида + КПП + смета. */
async function allScreens(): Promise<Screen[]> {
  const ctx = e2eContext();
  const p = (name: string, rest: string, fit = false): Screen => ({ name, path: projectPath(ctx, rest), fit });
  const db = e2eDb();
  const actor = await db.actor.findFirst({ where: { projectId: ctx.projectId }, select: { id: true } });
  // Смета по статьям (сид волны «Смета по статьям»): цех с утверждённой версией по статьям.
  const sound = await db.department.findFirst({ where: { projectId: ctx.projectId, name: "Звуковой цех" }, select: { id: true } });
  await db.$disconnect();
  const dep = ctx.smetaDepartmentId ?? ctx.departmentId;
  const fitted = new Set(["screenplay-version"]);
  const packs = ["1", "2", "3", "4", "5", "6", "7"].flatMap(packScreens).map((s) => ({ ...s, fit: fitted.has(s.name) }));
  return [
    { name: "projects", path: "/ru/projects" },
    ...packs,
    p("kpp", "/schedule", true),
    p("audition", `/preproduction/auditions/${ctx.auditionId}`),
    p("scout-candidate", `/preproduction/scout/${ctx.scoutCandidateId}`),
    p("payment", `/payments/${ctx.paymentId}`),
    p("counterparty", `/counterparties/${ctx.counterpartyId}`),
    p("contract", `/counterparties/contracts/${ctx.contractId}`),
    p("ledger-actor", `/resource-usage/actors/${actor?.id}`),
    p("ledger-resource", `/resource-usage/resources/${ctx.vehicle.itemId}`),
    p("smeta-editor", `/smeta/${dep}`, true),
    p("smeta-review", `/smeta/${dep}/review`),
    p("smeta-versions", `/smeta/${dep}/versions`),
    p("smeta-drafts", `/smeta/${dep}?tab=drafts`, true),
    p("smeta-template", "/smeta/template"),
    p("smeta-summary-articles", "/smeta/summary?drafts=1&view=articles"),
    ...(sound ? [p("smeta-version-items", `/smeta/${sound.id}/versions/1`)] : []),
  ];
}

/** Страницы без входа. */
const PUBLIC_SCREENS: Screen[] = [
  { name: "login", path: "/ru/login" },
  { name: "register", path: "/ru/register" },
  { name: "forgot-password", path: "/ru/forgot-password" },
  { name: "reset-password", path: "/ru/reset-password?token=e2e" },
  { name: "invite", path: "/ru/invite/e2e-unknown" },
];

/**
 * Обход всех экранов (шаг 7): `DESIGN_CRAWL=1`. Снимки — `<папка>/<ширина>/<экран>-<тема>.png`;
 * рядом `contrast.json`, `overflow.json` (шире экрана), `console-errors.json`, `http-errors.json`.
 */
test.describe("design crawl", () => {
  test.skip(!SHOTS || !process.env.DESIGN_CRAWL, "только с DESIGN_SHOTS и DESIGN_CRAWL=1");

  async function crawl(page: Page, list: Screen[], theme: string, width: number) {
    const dir = path.join(OUT, String(width));
    mkdirSync(dir, { recursive: true });
    await page.addInitScript((t) => window.localStorage.setItem("filmprod-theme", t), theme);
    const result = {
      contrast: {} as Record<string, ContrastIssue[]>,
      overflow: {} as Record<string, number>,
      console: {} as Record<string, string[]>,
      http: {} as Record<string, number>,
    };
    for (const screen of list) {
      const key = `${screen.name}-${theme}`;
      const errors: string[] = [];
      const onConsole = (m: { type(): string; text(): string }) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 200));
      };
      page.on("console", onConsole);
      const response = await page.goto(screen.path);
      if (response && response.status() >= 400) result.http[key] = response.status();
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      if (screen.name.startsWith("smeta-editor") || screen.name === "smeta-summary") await page.waitForTimeout(2500);
      // Прокручивается main, поэтому считаем и его: страница не шире экрана.
      const scrollWidth = await page.evaluate(() =>
        Math.max(document.documentElement.scrollWidth, document.querySelector("main")?.scrollWidth ?? 0),
      );
      if (scrollWidth > width + 1) result.overflow[key] = scrollWidth;
      if (!screen.fit) {
        await page.evaluate(() => {
          const main = document.querySelector("main");
          if (main?.parentElement) {
            main.parentElement.style.height = "auto";
            main.parentElement.style.overflow = "visible";
            main.style.overflow = "visible";
          }
        });
      }
      await page.screenshot({ path: path.join(dir, `${key}.png`), fullPage: !screen.fit });
      const issues = await contrastIssues(page);
      if (issues.length) result.contrast[key] = issues;
      page.off("console", onConsole);
      if (errors.length) result.console[key] = errors;
    }
    return result;
  }

  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`crawl ${width} ${theme}`, async ({ browser }) => {
        test.setTimeout(1_800_000);
        const height = width === 390 ? 844 : 900;
        const authed = await browser.newContext({ storageState: storageStatePath("producer"), viewport: { width, height } });
        const anonymous = await browser.newContext({ viewport: { width, height } });
        // DESIGN_FILTER — только экраны, чьё имя начинается с него (например, «smeta»).
        const only = process.env.DESIGN_FILTER ?? "";
        const pick = (list: Screen[]) => (only ? list.filter((s) => s.name.startsWith(only) || s.name === "plan-fact") : list);
        const a = await crawl(await authed.newPage(), pick(await allScreens()), theme, width);
        const b = await crawl(await anonymous.newPage(), only ? [] : PUBLIC_SCREENS, theme, width);
        await authed.close();
        await anonymous.close();
        writeFileSync(
          path.join(OUT, String(width), `report-${theme}.json`),
          JSON.stringify(
            {
              contrast: { ...a.contrast, ...b.contrast },
              overflow: { ...a.overflow, ...b.overflow },
              http: { ...a.http, ...b.http },
              console: { ...a.console, ...b.console },
            },
            null,
            2,
          ),
        );
      });
    }
  }
});

/** Сколько главных кнопок на экране: правило «одна главная» (`DESIGN_PRIMARY=1`, отчёт шага 7). */
test.describe("design primary", () => {
  test.skip(!SHOTS || !process.env.DESIGN_PRIMARY, "только с DESIGN_SHOTS и DESIGN_PRIMARY=1");
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 1280, height: 900 } });

  test("primary buttons", async ({ page }) => {
    test.setTimeout(600_000);
    const found: Record<string, string[]> = {};
    for (const screen of await allScreens()) {
      await page.goto(screen.path);
      await page.waitForLoadState("networkidle");
      const labels = await page.locator("main .glass-btn-primary:visible").allInnerTexts();
      if (labels.length > 1) found[screen.name] = labels;
    }
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "primary-buttons.json"), JSON.stringify(found, null, 2));
  });
});

test.describe("design pack", () => {
  const pack = process.env.DESIGN_PACK ?? "";
  test.skip(!SHOTS || !pack, "только с DESIGN_SHOTS и DESIGN_PACK");
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 1280, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`pack ${pack} ${theme}`, async ({ page }) => {
      test.setTimeout(600_000);
      mkdirSync(OUT, { recursive: true });
      await page.addInitScript((t) => window.localStorage.setItem("filmprod-theme", t), theme);
      const contrast: Record<string, ContrastIssue[]> = {};
      for (const screen of packScreens(pack)) {
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        // Прокручивается main, а не окно: на снимке — страница целиком.
        await page.evaluate(() => {
          const main = document.querySelector("main");
          if (main?.parentElement) {
            main.parentElement.style.height = "auto";
            main.parentElement.style.overflow = "visible";
            main.style.overflow = "visible";
          }
        });
        await page.screenshot({ path: path.join(OUT, `${screen.name}-${theme}.png`), fullPage: true });
        const issues = await contrastIssues(page);
        if (issues.length) contrast[screen.name] = issues;
      }
      writeFileSync(path.join(OUT, `contrast-${theme}.json`), JSON.stringify(contrast, null, 2));
    });
  }
});

test.describe("design screens", () => {
  test.skip(!SHOTS || !!process.env.DESIGN_PACK || !!process.env.DESIGN_CRAWL || !!process.env.DESIGN_PRIMARY, "только с DESIGN_SHOTS=<папка>");
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 1280, height: 900 } });

  const contrast: Record<string, ContrastIssue[]> = {};
  const consoleErrors: Record<string, string[]> = {};

  test.afterAll(() => {
    if (!SHOTS) return;
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path.join(OUT, "contrast.json"), JSON.stringify(contrast, null, 2));
    writeFileSync(path.join(OUT, "console-errors.json"), JSON.stringify(consoleErrors, null, 2));
  });

  for (const theme of ["light", "dark"] as const) {
    test(theme, async ({ page }) => {
      test.setTimeout(300_000);
      mkdirSync(OUT, { recursive: true });
      await page.addInitScript((t) => window.localStorage.setItem("filmprod-theme", t), theme);
      for (const screen of screens()) {
        const key = `${screen.name}-${theme}`;
        const errors: string[] = [];
        const onConsole = (m: { type(): string; text(): string }) => {
          if (m.type() === "error") errors.push(m.text().slice(0, 300));
        };
        page.on("console", onConsole);
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(OUT, `${key}.png`), fullPage: false });
        contrast[key] = await contrastIssues(page);
        page.off("console", onConsole);
        if (errors.length) consoleErrors[key] = errors;
      }
    });
  }
});
