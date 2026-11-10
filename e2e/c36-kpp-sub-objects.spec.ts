import { expect, test } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * КПП и подобъекты (волна feat/sub-objects). Карточка сцены в КПП — объект и подобъекты
 * («ДОМ · ДЕТСКАЯ / КОРИДОР»); фильтр и группировка — по объекту.
 */

const ctx = e2eContext();
const db = e2eDb();
const OBJECT = "Е2Е ДОМ КПП";
const OTHER = "Е2Е ОПУШКА КПП";
const NUMBERS = ["993", "994"];

async function cleanup() {
  await db.scene.deleteMany({ where: { projectId: ctx.projectId, number: { in: NUMBERS } } });
  const rows = await db.location.findMany({
    where: { projectId: ctx.projectId, OR: [{ name: { in: [OBJECT, OTHER] } }, { parent: { name: OBJECT } }] },
    select: { id: true, parentId: true },
  });
  await db.location.deleteMany({ where: { id: { in: rows.filter((r) => r.parentId).map((r) => r.id) } } });
  await db.location.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

test.describe("КПП: объекты и подобъекты", () => {
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  test("карточка сцены с подобъектами, фильтр и группировка по объекту", async ({ page }) => {
    const object = await db.location.create({ data: { projectId: ctx.projectId, name: OBJECT } });
    const kids = await db.location.create({
      data: { projectId: ctx.projectId, name: "ДЕТСКАЯ", parentId: object.id, sortOrder: 1 },
    });
    const hall = await db.location.create({
      data: { projectId: ctx.projectId, name: "КОРИДОР", parentId: object.id, sortOrder: 2 },
    });
    const other = await db.location.create({ data: { projectId: ctx.projectId, name: OTHER } });
    await db.scene.create({
      data: {
        projectId: ctx.projectId,
        number: NUMBERS[0]!,
        summary: "Е2Е КПП смежная",
        sortOrder: 9930,
        locations: { create: [{ locationId: kids.id }, { locationId: hall.id }] },
      },
    });
    await db.scene.create({
      data: {
        projectId: ctx.projectId,
        number: NUMBERS[1]!,
        summary: "Е2Е КПП другой объект",
        sortOrder: 9940,
        locations: { create: [{ locationId: other.id }] },
      },
    });

    await page.goto(projectPath(ctx, "/schedule"));
    // Нераспределённые сцены: у смежной — объект и оба подобъекта.
    await expect(page.getByText(`${OBJECT} · ДЕТСКАЯ / КОРИДОР`)).toBeVisible();
    await expect(page.getByText(OTHER, { exact: true }).and(page.locator(":not(option)"))).toBeVisible();

    // Фильтр по объекту: в списке объект (не подобъекты), чужая сцена скрыта.
    await page.getByRole("button", { name: /^Фильтры/ }).click();
    const objectFilter = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "Все объекты" }) });
    await expect(objectFilter.locator(`option[value="${OBJECT}"]`)).toHaveCount(1);
    await expect(objectFilter.locator('option[value="ДЕТСКАЯ"]')).toHaveCount(0);
    await objectFilter.selectOption(OBJECT);
    await expect(page.getByText(`${OBJECT} · ДЕТСКАЯ / КОРИДОР`)).toBeVisible();
    await expect(page.getByText(OTHER, { exact: true }).and(page.locator(":not(option)"))).toHaveCount(0);

    // Группировка по объекту: заголовок группы — объект.
    await objectFilter.selectOption("");
    await page.locator("select").filter({ hasText: "Группировать по объекту" }).selectOption("location");
    await expect(page.getByText(`${OBJECT} (1)`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${OTHER} (1)`, { exact: true })).toBeVisible();
  });
});
