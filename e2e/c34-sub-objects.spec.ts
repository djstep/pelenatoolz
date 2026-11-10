import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Объекты и подобъекты (волна feat/sub-objects, шаг 2). Окно «Добавление локации» с подлокацией
 * создаёт подобъект под объектом (объекта нет — создаётся), список держит подобъекты сразу за
 * объектом в их порядке, объект с подобъектами не удаляется.
 */

const ctx = e2eContext();
const db = e2eDb();
const LOCATIONS_PATH = projectPath(ctx, "/locations");
const OBJECT = "Е2Е ДОМ ПОДОБЪЕКТЫ";

async function cleanup() {
  const where = { projectId: ctx.projectId, OR: [{ name: OBJECT }, { parent: { name: OBJECT } }] };
  const rows = await db.location.findMany({ where, select: { id: true, parentId: true } });
  await db.location.deleteMany({ where: { id: { in: rows.filter((r) => r.parentId).map((r) => r.id) } } });
  await db.location.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

async function addLocation(page: Page, name: string, sub: string) {
  await page.getByRole("button", { name: "+ Добавить локацию" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Название локации *").fill(name);
  await dialog.getByLabel("Подлокация").fill(sub);
  await dialog.getByRole("radio").first().check();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe("объекты и подобъекты", () => {
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  test("подлокация — подобъект объекта; порядок в списке; объект с подобъектами не удаляется", async ({ page }) => {
    await page.goto(LOCATIONS_PATH);
    await addLocation(page, OBJECT, "КУХНЯ");
    await addLocation(page, OBJECT.toLowerCase(), "ДЕТСКАЯ");

    // В базе: один объект (второе написание нашло тот же), два подобъекта по порядку добавления.
    const object = await db.location.findFirstOrThrow({
      where: { projectId: ctx.projectId, name: OBJECT, parentId: null },
      select: { id: true, sublocation: true, children: { orderBy: { sortOrder: "asc" }, select: { name: true, sublocation: true, sortOrder: true } } },
    });
    expect(object.sublocation).toBeNull();
    expect(object.children).toEqual([
      { name: "КУХНЯ", sublocation: null, sortOrder: 1 },
      { name: "ДЕТСКАЯ", sublocation: null, sortOrder: 2 },
    ]);

    // В списке: объект, затем подобъекты в своём порядке (КУХНЯ раньше ДЕТСКОЙ).
    await page.reload();
    const names = await page.locator("tbody tr td:first-child a").allInnerTexts();
    const ours = names.filter((n) => n.startsWith(OBJECT));
    expect(ours).toEqual([OBJECT, `${OBJECT}.КУХНЯ`, `${OBJECT}.ДЕТСКАЯ`]);

    // Удаление объекта: в окне — предупреждение, после подтверждения — отказ, объект на месте.
    const row = page.locator("tbody tr").filter({ has: page.getByRole("link", { name: OBJECT, exact: true }) });
    await row.getByRole("button", { name: "Удалить локацию" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("Подобъекты (пока они есть, объект не удалится): 2")).toBeVisible();
    await confirm.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(confirm.getByText("У объекта есть подобъекты")).toBeVisible();
    expect(await db.location.count({ where: { id: object.id } })).toBe(1);
  });
});
