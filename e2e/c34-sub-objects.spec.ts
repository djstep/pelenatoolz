import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Объекты и подобъекты (волна feat/sub-objects). «Объекты» — дерево: объект, под ним его
 * подобъекты в своём порядке. Окно с подобъектом создаёт подобъект под объектом (объекта нет —
 * создаётся); «+ подобъект» — тип от объекта; стрелки меняют порядок; объект сворачивается;
 * объект с подобъектами не удаляется.
 */

const ctx = e2eContext();
const db = e2eDb();
const LOCATIONS_PATH = projectPath(ctx, "/locations");
const OBJECT = "Е2Е ДОМ ПОДОБЪЕКТЫ";
const SHOT = process.env.E2E_SUB_OBJECTS_SHOT;

async function cleanup() {
  const where = { projectId: ctx.projectId, OR: [{ name: OBJECT }, { parent: { name: OBJECT } }] };
  const rows = await db.location.findMany({ where, select: { id: true, parentId: true } });
  await db.location.deleteMany({ where: { id: { in: rows.filter((r) => r.parentId).map((r) => r.id) } } });
  await db.location.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

async function addLocation(page: Page, name: string, sub: string) {
  await page.getByRole("button", { name: "+ Добавить объект" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Объект *").fill(name);
  await dialog.getByLabel("Подобъект", { exact: true }).fill(sub);
  await dialog.getByRole("radio", { name: "Нат", exact: true }).check();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Подписи строк нашего объекта сверху вниз (полные: «ОБЪЕКТ.ПОДОБЪЕКТ»). */
async function ourRows(page: Page) {
  const labels = await page
    .locator("tbody tr td:first-child a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("aria-label") ?? ""));
  return labels.filter((n) => n.startsWith(OBJECT));
}

async function children() {
  const object = await db.location.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: OBJECT, parentId: null },
    select: {
      id: true,
      children: { orderBy: { sortOrder: "asc" }, select: { name: true, sortOrder: true, locationKind: true } },
    },
  });
  return object;
}

test.describe("объекты и подобъекты", () => {
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  test("дерево: подобъект через окно, «+ подобъект», порядок, свернуть, отказ удаления", async ({ page }) => {
    await page.goto(LOCATIONS_PATH);
    await addLocation(page, OBJECT, "КУХНЯ");
    await addLocation(page, OBJECT.toLowerCase(), "ДЕТСКАЯ");

    // В базе: один объект (второе написание нашло тот же), подобъекты по порядку добавления.
    let object = await children();
    expect(object.children.map((c) => [c.name, c.sortOrder])).toEqual([
      ["КУХНЯ", 1],
      ["ДЕТСКАЯ", 2],
    ]);

    // «+ подобъект»: объект заполнен, тип — от объекта (у объекта, созданного попутно, типа нет —
    // зададим его объекту и проверим, что новый подобъект его получил).
    await db.location.update({ where: { id: object.id }, data: { locationKind: "INT" } });
    await page.reload();
    await page.getByRole("button", { name: `Действия: ${OBJECT}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Добавить подобъект" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Объект *")).toHaveValue(OBJECT);
    await expect(dialog.getByRole("radio", { name: "Инт", exact: true })).toBeChecked();
    await dialog.getByLabel("Подобъект", { exact: true }).fill("КОРИДОР");
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toHaveCount(0);

    // Список: объект, затем подобъекты в своём порядке (не по алфавиту).
    await expect.poll(() => ourRows(page)).toEqual([
      OBJECT,
      `${OBJECT}.КУХНЯ`,
      `${OBJECT}.ДЕТСКАЯ`,
      `${OBJECT}.КОРИДОР`,
    ]);
    object = await children();
    expect(object.children.find((c) => c.name === "КОРИДОР")?.locationKind).toBe("INT");

    // Порядок: КОРИДОР выше — встаёт перед ДЕТСКОЙ; у первого подобъекта «выше» нет.
    await page.getByRole("button", { name: `Выше: ${OBJECT}.КОРИДОР` }).click();
    await expect.poll(() => ourRows(page)).toEqual([
      OBJECT,
      `${OBJECT}.КУХНЯ`,
      `${OBJECT}.КОРИДОР`,
      `${OBJECT}.ДЕТСКАЯ`,
    ]);
    await expect(page.getByRole("button", { name: `Выше: ${OBJECT}.КУХНЯ` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Ниже: ${OBJECT}.ДЕТСКАЯ` })).toBeDisabled();
    object = await children();
    expect(object.children.map((c) => [c.name, c.sortOrder])).toEqual([
      ["КУХНЯ", 1],
      ["КОРИДОР", 2],
      ["ДЕТСКАЯ", 3],
    ]);
    // 1280 px: таблица помещается без прокрутки вбок.
    const table = page.locator("table").locator("xpath=..");
    const overflow = await table.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });

    // Адрес объекта — у подобъектов без своего адреса «(как у объекта)».
    await db.location.update({ where: { id: object.id }, data: { address: "Е2Е ул. Лесная, 1" } });
    await page.reload();
    await expect(page.getByText("Е2Е ул. Лесная, 1 (как у объекта)")).toHaveCount(3);

    // Свернуть объект — подобъекты скрыты, развернуть — снова видны.
    await page.getByRole("button", { name: `Свернуть «${OBJECT}»` }).click();
    await expect.poll(() => ourRows(page)).toEqual([OBJECT]);
    await page.getByRole("button", { name: `Развернуть «${OBJECT}»` }).click();
    await expect.poll(() => ourRows(page)).toHaveLength(4);

    // Удаление объекта: в окне — предупреждение, после подтверждения — отказ, объект на месте.
    await page.getByRole("button", { name: `Действия: ${OBJECT}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Удалить", exact: true }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Подобъекты (пока они есть, объект не удалится): 3")).toBeVisible();
    await confirm.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(confirm.getByText("У объекта есть подобъекты")).toBeVisible();
    expect(await db.location.count({ where: { id: object.id } })).toBe(1);
  });
});
