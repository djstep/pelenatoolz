import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CREW } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Снимки экранов команды: обе темы, 1280 и 390 px. Только по команде: `E2E_STATE_SHOTS=<папка>`.
 * Заодно проверяет, что на 390 px страницу не распирает вбок.
 */

const DIR = process.env.E2E_STATE_SHOTS;
const ctx = e2eContext();
const db = e2eDb();
const CREW_PATH = projectPath(ctx, "/crew");
const LINKED = CREW.linked;
const MANUAL = CREW.manual;
const COUNTERPARTY = CREW.contracts.individual.counterparty;
const NEW_CONTACTS = "+7 900 111-00-99, svetov.new@e2e.test";

test.skip(!DIR, "только с E2E_STATE_SHOTS");
test.use({ storageState: storageStatePath("producer") });

/** Переключение темы плавное: снимок сразу после него попадает в середину перехода. */
const THEME_SETTLE_MS = 500;

async function shots(page: Page, name: string) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await page.waitForTimeout(THEME_SETTLE_MS);
      await page.screenshot({ path: path.join(DIR!, `${name}-${theme}-${width}.png`) });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name}: ширина ${width}`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function openCard(page: Page, fullName: string) {
  await page.goto(CREW_PATH);
  await page.getByRole("button", { name: fullName, exact: true }).click();
  return page.getByRole("dialog");
}

test.afterAll(() => db.$disconnect());

test("список", async ({ page }) => {
  await page.goto(CREW_PATH);
  await expect(page.getByRole("heading", { name: "Команда", exact: true })).toBeVisible();
  await shots(page, "crew-list");
});

test("Подтянуть", async ({ page }) => {
  await page.goto(CREW_PATH);
  await page.getByRole("button", { name: "Подтянуть из договоров" }).click();
  await expect(page.getByRole("dialog").getByText("Загрузка…")).toHaveCount(0);
  await shots(page, "crew-pull");
});

test("Связать с договором", async ({ page }) => {
  const dialog = await openCard(page, `${MANUAL.lastName} ${MANUAL.firstName}`);
  await dialog.getByRole("button", { name: "Связать с договором" }).click();
  const link = page.getByRole("dialog", { name: /Связать с договором:/ });
  await expect(link.getByTestId("crew-link-option").first()).toBeVisible();
  await shots(page, "crew-link");
});

test.describe("Обновить из договора", () => {
  let originalContacts: string | null = null;
  let counterpartyId = "";

  test.beforeAll(async () => {
    const counterparty = await db.counterparty.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: COUNTERPARTY },
      select: { id: true, contacts: true },
    });
    counterpartyId = counterparty.id;
    originalContacts = counterparty.contacts;
    await db.counterparty.update({ where: { id: counterpartyId }, data: { contacts: NEW_CONTACTS } });
  });

  test.afterAll(async () => {
    await db.counterparty.update({ where: { id: counterpartyId }, data: { contacts: originalContacts } });
  });

  test("разница с договором", async ({ page }) => {
    const dialog = await openCard(page, `${LINKED.lastName} ${LINKED.firstName} ${LINKED.middleName}`);
    await dialog.getByRole("button", { name: "Обновить из договора" }).click();
    const sync = page.getByRole("dialog", { name: /Обновить из договора:/ });
    await expect(sync.locator('[data-sync-field="phone"]')).toBeVisible();
    await shots(page, "crew-sync");
  });
});

test("Экспорт и печать", async ({ page }) => {
  await page.goto(CREW_PATH);
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await page.getByRole("menuitem", { name: "Печать", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Загрузка раскладки…")).toHaveCount(0);
  await shots(page, "crew-export-modal");

  const popupPromise = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Печать", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("heading", { name: "Команда", exact: true })).toBeVisible();
  await popup.waitForLoadState();
  for (const width of [1280, 390]) {
    await popup.setViewportSize({ width, height: 900 });
    for (const colorScheme of ["light", "dark"] as const) {
      await popup.emulateMedia({ colorScheme });
      await popup.screenshot({ path: path.join(DIR!, `crew-print-${colorScheme}-${width}.png`), fullPage: true });
    }
  }
  await popup.close();
});
