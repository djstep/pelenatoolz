import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Волна 7: полоса вкладок раздела над существующими страницами, адреса те же. На Кастинге
 * право на обе вкладки одно, поэтому частичное скрытие здесь проверить нельзя: его логику
 * держит `project-nav-groups.test.ts`.
 */

const ctx = e2eContext();
const CASTING = projectPath(ctx, "/preproduction/casting");
const AUDITIONS = projectPath(ctx, "/preproduction/auditions");

const tabsBar = (page: Page) => page.getByRole("navigation", { name: "Вкладки раздела" });
const tab = (page: Page, name: string) => tabsBar(page).getByRole("link", { name, exact: true });
const menuItem = (page: Page) => page.getByRole("link", { name: "Кастинг", exact: true });

/** Раздел меню раскрыт и отмечен активным, пункт «Кастинг» выделен. */
async function expectMenuOnCasting(page: Page) {
  // Свёрнутая группа остаётся в разметке, поэтому смотрим состояние кнопки, а не видимость пункта.
  await expect(page.getByRole("button", { name: "Препродакшн здесь" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(menuItem(page)).toHaveClass(/font-semibold/);
  await expect(page.getByRole("link", { name: "Скаут", exact: true })).not.toHaveClass(/font-semibold/);
}

async function expectCastingTab(page: Page) {
  await expect(page.getByRole("heading", { name: "Кастинг", exact: true })).toBeVisible();
  await expect(tab(page, "Кандидаты")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "Пробы")).not.toHaveAttribute("aria-current", "page");
}

async function expectAuditionsTab(page: Page) {
  await expect(page.getByRole("heading", { name: "Кастинг-пробы", exact: true })).toBeVisible();
  await expect(tab(page, "Пробы")).toHaveAttribute("aria-current", "page");
  await expect(tab(page, "Кандидаты")).not.toHaveAttribute("aria-current", "page");
}

test.describe("вкладки Кастинга, продюсер", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("переход по вкладкам, «Назад» и «Вперёд»; меню и подпись раздела на обеих", async ({ page }) => {
    await page.goto(CASTING);
    await expectCastingTab(page);

    await tab(page, "Пробы").click();
    await expect(page).toHaveURL(new RegExp(`${AUDITIONS}$`));
    await expectAuditionsTab(page);
    await expect(page.locator("main").getByText("Препродакшн", { exact: true })).toBeVisible();
    await expectMenuOnCasting(page);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${CASTING}$`));
    await expectCastingTab(page);

    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`${AUDITIONS}$`));
    await expectAuditionsTab(page);
  });

  test("прямая ссылка на пробы: вкладка выбрана, раздел меню раскрыт", async ({ page }) => {
    await page.goto(AUDITIONS);
    await expectAuditionsTab(page);
    await expectMenuOnCasting(page);
    await expect(menuItem(page)).toHaveAttribute("href", CASTING);
    await expect(page.getByRole("link", { name: "Кастинг-пробы" })).toHaveCount(0);
  });

  test("вкладка открывается в новой вкладке браузера", async ({ page, context }) => {
    await page.goto(CASTING);
    await expectCastingTab(page);
    const opened = context.waitForEvent("page");
    await tab(page, "Пробы").click({ modifiers: ["Control"] });
    const next = await opened;
    await next.waitForLoadState();
    await expect(next).toHaveURL(new RegExp(`${AUDITIONS}$`));
    await expectAuditionsTab(next);
    await next.close();
    await expect(page).toHaveURL(new RegExp(`${CASTING}$`));
  });

  test("на карточке кандидата полосы нет, ссылка назад к списку на месте", async ({ page }) => {
    await page.goto(`${CASTING}/${ctx.castingPersonId}`);
    await expect(page.getByRole("link", { name: "← Кастинг" })).toBeVisible();
    await expect(tabsBar(page)).toHaveCount(0);
  });

  test("на странице без вкладок полосы нет", async ({ page }) => {
    await page.goto(projectPath(ctx, "/preproduction/scout"));
    await expect(page.locator("main").getByText("Препродакшн", { exact: true })).toBeVisible();
    await expect(tabsBar(page)).toHaveCount(0);
  });

  test("несохранённые изменения: клик по вкладке спрашивает, «Остаться» оставляет введённое", async ({ page }) => {
    await page.goto(CASTING);
    await expectCastingTab(page);
    await page.getByRole("button", { name: "+ Кандидат" }).click();
    const dialog = page.getByRole("dialog", { name: "Новый кандидат" });
    const lastName = dialog.locator("#lastName");
    await expect(lastName).toBeVisible();
    // Окно запоминает исходные значения через 150 мс (`modal.tsx`).
    await page.waitForTimeout(300);
    await lastName.fill("Несохранённый");

    // Окно накрывает полосу: клик идёт прямо в ссылку, это проверка перехватчика переходов.
    const clickTab = () => tab(page, "Пробы").evaluate((link) => (link as HTMLAnchorElement).click());

    await clickTab();
    const question = page.getByRole("alertdialog");
    await expect(question.getByRole("button", { name: "Не сохранять" })).toBeVisible();
    await question.getByRole("button", { name: "Остаться" }).click();
    await expect(question).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${CASTING}$`));
    await expect(lastName).toHaveValue("Несохранённый");

    await clickTab();
    await question.getByRole("button", { name: "Не сохранять" }).click();
    await expect(page).toHaveURL(new RegExp(`${AUDITIONS}$`));
    await expectAuditionsTab(page);
  });
});

for (const role of ["nofin", "crewonly"] as const) {
  test.describe(`вкладки Кастинга, ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test("обе вкладки видны и открываются", async ({ page }) => {
      await page.goto(CASTING);
      await expectCastingTab(page);
      await tab(page, "Пробы").click();
      await expect(page).toHaveURL(new RegExp(`${AUDITIONS}$`));
      await expectAuditionsTab(page);
    });
  });
}

/** Полоса на месте: ровно эти вкладки, выбрана нужная. */
async function expectTabs(page: Page, labels: string[], active: string | null) {
  await expect(tabsBar(page).getByRole("link")).toHaveCount(labels.length);
  for (const label of labels) {
    const link = tab(page, label);
    if (label === active) await expect(link).toHaveAttribute("aria-current", "page");
    else await expect(link).not.toHaveAttribute("aria-current", "page");
  }
}

const groupButton = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name} здесь` });

for (const role of ["producer", "nofin", "crewonly"] as const) {
  test.describe(`вкладки Участников, ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test("Участники · Роли и права; раздел меню раскрыт на обеих", async ({ page }) => {
      await page.goto(projectPath(ctx, "/members"));
      await expectTabs(page, ["Участники", "Роли и права"], "Участники");
      await tab(page, "Роли и права").click();
      await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, "/roles")}$`));
      await expectTabs(page, ["Участники", "Роли и права"], "Роли и права");
      await expect(groupButton(page, "Настройки")).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("link", { name: "Роли и права" })).toHaveCount(1);
    });
  });
}

test.describe("вкладки Операций", () => {
  test.use({ storageState: storageStatePath("producer") });

  const TABS = ["Операции", "Начисления", "Платежи"];

  test("переход, подсветка, подпись раздела; на вводе смен полосы нет", async ({ page }) => {
    await page.goto(projectPath(ctx, "/finance"));
    await expectTabs(page, TABS, "Операции");
    await expect(page.getByRole("heading", { name: "Финансовый контроль" })).toBeVisible();

    for (const [label, rest] of [["Начисления", "/accruals"], ["Платежи", "/payments"]] as const) {
      await tab(page, label).click();
      await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, rest)}$`));
      await expectTabs(page, TABS, label);
      await expect(page.locator("main").getByText("Финансы", { exact: true })).toBeVisible();
      await expect(groupButton(page, "Финансы")).toHaveAttribute("aria-expanded", "true");
      await expect(
        page.getByRole("complementary").getByRole("link", { name: "Операции", exact: true }),
      ).toHaveClass(/font-semibold/);
    }

    await page.goto(projectPath(ctx, "/accruals/shift-entry"));
    await expect(page.locator("main").getByText("Финансы", { exact: true })).toBeVisible();
    await expect(tabsBar(page)).toHaveCount(0);
  });

  test("отчёты финансов — свой пункт, без полосы", async ({ page }) => {
    await page.goto(projectPath(ctx, "/finance/reports"));
    await expect(page.getByRole("heading", { name: "Отчёты", exact: true })).toBeVisible();
    await expect(tabsBar(page)).toHaveCount(0);
  });
});

test.describe("вкладки Операций, без финансов", () => {
  test.use({ storageState: storageStatePath("nofin") });

  test("прямой заход — как раньше: нет доступа, полосы нет", async ({ page }) => {
    await page.goto(projectPath(ctx, "/accruals"));
    await expect(page.getByText("Нет доступа", { exact: false }).first()).toBeVisible();
    await expect(tabsBar(page)).toHaveCount(0);
  });
});

test.describe("вкладки Контрагентов", () => {
  const BASE = projectPath(ctx, "/counterparties");
  const db = e2eDb();

  test.afterAll(() => db.$disconnect());

  test.describe("продюсер", () => {
    test.use({ storageState: storageStatePath("producer") });

    test("три вкладки, переходы, полоса на карточках, заголовок раздела под полосой", async ({ page }) => {
      const contract = await db.contract.findFirstOrThrow({ where: { projectId: ctx.projectId } });
      const TABS = ["Справочник", "Договоры", "Акты"];
      await page.goto(BASE);
      await expectTabs(page, TABS, "Справочник");
      await expect(page.getByRole("heading", { name: "Контрагенты", exact: true })).toBeVisible();

      await tab(page, "Акты").click();
      await expect(page).toHaveURL(new RegExp(`${BASE}/acts$`));
      await expectTabs(page, TABS, "Акты");

      await page.goto(`${BASE}/contracts/${contract.id}`);
      await expectTabs(page, TABS, "Договоры");

      await page.goto(`${BASE}/${contract.counterpartyId}`);
      await expectTabs(page, TABS, null);
    });
  });

  test.describe("без финансов", () => {
    test.use({ storageState: storageStatePath("nofin") });

    test("Договоры · Акты без Справочника; пункт ведёт на договоры", async ({ page }) => {
      const contract = await db.contract.findFirstOrThrow({ where: { projectId: ctx.projectId } });
      await page.goto(`${BASE}/acts`);
      await expectTabs(page, ["Договоры", "Акты"], "Акты");
      await expect(tab(page, "Справочник")).toHaveCount(0);
      const item = page.getByRole("complementary").getByRole("link", { name: "Контрагенты", exact: true });
      await expect(item).toHaveAttribute("href", `${BASE}/contracts`);

      await page.goto(`${BASE}/contracts/${contract.id}`);
      await expectTabs(page, ["Договоры", "Акты"], "Договоры");
    });

    test("прямой заход на справочник — как раньше: переход к договорам", async ({ page }) => {
      await page.goto(BASE);
      await expect(page).toHaveURL(new RegExp(`${BASE}/contracts$`));
      await expectTabs(page, ["Договоры", "Акты"], "Договоры");
    });

    test("карточка контрагента — как раньше: нет доступа, полоса на месте", async ({ page }) => {
      const contract = await db.contract.findFirstOrThrow({ where: { projectId: ctx.projectId } });
      await page.goto(`${BASE}/${contract.counterpartyId}`);
      await expect(page.getByText("Нет доступа к финансам")).toBeVisible();
      await expectTabs(page, ["Договоры", "Акты"], null);
    });
  });

  test.describe("crewonly", () => {
    test.use({ storageState: storageStatePath("crewonly") });

    test("пункта нет, прямой заход — нет доступа, полосы нет", async ({ page }) => {
      await page.goto(`${BASE}/contracts`);
      await expect(page.getByText("Нет доступа к договорам")).toBeVisible();
      await expect(page.getByRole("link", { name: "Контрагенты", exact: true })).toHaveCount(0);
      await expect(tabsBar(page)).toHaveCount(0);
      await page.goto(BASE);
      await expect(page.getByText("Нет доступа к финансам")).toBeVisible();
      await expect(tabsBar(page)).toHaveCount(0);
    });
  });
});

test.describe("форма приглашения на «Участниках»", () => {
  test.use({ storageState: storageStatePath("producer") });

  const EMAIL = "e2e-tabs-invite@pelena.test";
  const db = e2eDb();
  const invites = () => db.projectInvite.count({ where: { projectId: ctx.projectId, email: EMAIL } });

  test.afterAll(async () => {
    await db.projectInvite.deleteMany({ where: { projectId: ctx.projectId, email: EMAIL } });
    await db.$disconnect();
  });

  async function fillInvite(page: Page) {
    await page.goto(projectPath(ctx, "/members"));
    await expectTabs(page, ["Участники", "Роли и права"], "Участники");
    // Форма запоминает исходные значения через 150 мс (`use-form-guard.ts`).
    await page.waitForTimeout(300);
    await page.locator("#email").fill(EMAIL);
  }

  test("без изменений клик по вкладке вопроса не задаёт", async ({ page }) => {
    await page.goto(projectPath(ctx, "/members"));
    await expectTabs(page, ["Участники", "Роли и права"], "Участники");
    await page.waitForTimeout(300);
    await tab(page, "Роли и права").click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, "/roles")}$`));
  });

  test("«Остаться» оставляет почту, «Не сохранять» уходит, приглашения нет", async ({ page }) => {
    await fillInvite(page);
    await tab(page, "Роли и права").click();
    const question = page.getByRole("alertdialog");
    await expect(question.getByRole("button", { name: "Сохранить" })).toBeVisible();
    await question.getByRole("button", { name: "Остаться" }).click();
    await expect(question).toBeHidden();
    await expect(page.locator("#email")).toHaveValue(EMAIL);

    await tab(page, "Роли и права").click();
    await question.getByRole("button", { name: "Не сохранять" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, "/roles")}$`));
    expect(await invites()).toBe(0);
  });

  test("«Сохранить» создаёт приглашение и переходит", async ({ page }) => {
    await fillInvite(page);
    await tab(page, "Роли и права").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Сохранить" }).click();
    await expect(page).toHaveURL(new RegExp(`${projectPath(ctx, "/roles")}$`));
    expect(await invites()).toBe(1);
  });
});

test.describe("полоса вкладок на телефоне", () => {
  test.use({ storageState: storageStatePath("producer"), viewport: { width: 390, height: 844 } });

  /** Нет ли прокрутки вбок у страницы и у `main`, где на самом деле живёт содержимое. */
  async function expectNoOverflow(page: Page) {
    const sizes = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement;
      return {
        page: document.documentElement.scrollWidth,
        mainScroll: main.scrollWidth,
        mainClient: main.clientWidth,
      };
    });
    expect(sizes.page, "ширина страницы").toBeLessThanOrEqual(390);
    expect(sizes.mainScroll, "ширина main").toBeLessThanOrEqual(sizes.mainClient);
  }

  test("390 px: main не шире экрана на обеих вкладках", async ({ page }) => {
    await page.goto(CASTING);
    await expectCastingTab(page);
    await expectNoOverflow(page);
    await tab(page, "Пробы").click();
    await expectAuditionsTab(page);
    await expectNoOverflow(page);
  });

  test("не помещается: одна строка, прокрутка внутри полосы, активная вкладка видна", async ({ page }) => {
    // Две короткие вкладки на 390 px помещаются: сужаем окно, чтобы полосе пришлось прокручиваться.
    await page.setViewportSize({ width: 170, height: 844 });
    await page.goto(AUDITIONS);
    await expectAuditionsTab(page);

    // Полоса прокручивается после гидратации, поэтому ждём результат, а не читаем один раз.
    await expect
      .poll(() => tabsBar(page).evaluate((bar) => bar.scrollLeft), {
        message: "активная вкладка прокручена в видимую область",
      })
      .toBeGreaterThan(0);

    const layout = await tabsBar(page).evaluate((bar) => {
      const bounds = bar.getBoundingClientRect();
      const links = [...bar.querySelectorAll("a")].map((link) => link.getBoundingClientRect());
      const active = bar.querySelector('[aria-current="page"]')!.getBoundingClientRect();
      const main = document.querySelector("main") as HTMLElement;
      return {
        scrollable: bar.scrollWidth > bar.clientWidth,
        rows: new Set(links.map((link) => Math.round(link.top))).size,
        barLeft: bounds.left,
        barRight: bounds.right,
        activeLeft: active.left,
        activeRight: active.right,
        mainLeft: main.scrollLeft,
        mainTop: main.scrollTop,
        pageLeft: window.scrollX,
        pageTop: window.scrollY,
        focusOnBody: document.activeElement === document.body,
      };
    });
    expect(layout.scrollable, "полоса прокручивается").toBe(true);
    expect(layout.rows, "вкладки в одну строку").toBe(1);
    expect(layout.activeLeft).toBeGreaterThanOrEqual(layout.barLeft - 1);
    expect(layout.activeRight).toBeLessThanOrEqual(layout.barRight + 1);
    // Сдвинулась только полоса: страница, `main` и фокус остались на месте.
    expect(layout.mainLeft, "main по горизонтали").toBe(0);
    expect(layout.mainTop, "main по вертикали").toBe(0);
    expect(layout.pageLeft, "страница по горизонтали").toBe(0);
    expect(layout.pageTop, "страница по вертикали").toBe(0);
    expect(layout.focusOnBody, "фокус не сместился").toBe(true);
  });
});
