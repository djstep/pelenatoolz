import { expect, test } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Объединение объектов (волна feat/sub-objects, шаг 4): «ЗАГОРОДНЫЙ ДОМ» → «ДОМ» через «⋯ →
 * Объединить с…». Окно показывает, что произойдёт; после — объединяемого нет, одноимённые
 * подобъекты слились, сцена привязана к подобъекту оставшегося.
 */

const ctx = e2eContext();
const db = e2eDb();
const SOURCE = "Е2Е ЗАГОРОДНЫЙ ОБЪЕД";
const TARGET = "Е2Е ДОМ ОБЪЕД";
const SCENE_NUMBER = "995";

async function cleanup() {
  await db.scene.deleteMany({ where: { projectId: ctx.projectId, number: SCENE_NUMBER } });
  const rows = await db.location.findMany({
    where: {
      projectId: ctx.projectId,
      OR: [{ name: { in: [SOURCE, TARGET] } }, { parent: { name: { in: [SOURCE, TARGET] } } }],
    },
    select: { id: true, parentId: true },
  });
  await db.location.deleteMany({ where: { id: { in: rows.filter((r) => r.parentId).map((r) => r.id) } } });
  await db.location.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

test.describe("объединение объектов", () => {
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  test("«⋯ → Объединить с…»: что произойдёт, связи переходят, одноимённые подобъекты сливаются", async ({ page }) => {
    const source = await db.location.create({ data: { projectId: ctx.projectId, name: SOURCE } });
    const sourceKitchen = await db.location.create({
      data: { projectId: ctx.projectId, name: "КУХНЯ", parentId: source.id, sortOrder: 1 },
    });
    const sourceFacade = await db.location.create({
      data: { projectId: ctx.projectId, name: "ФАСАД", parentId: source.id, sortOrder: 2 },
    });
    const target = await db.location.create({ data: { projectId: ctx.projectId, name: TARGET } });
    const targetKitchen = await db.location.create({
      data: { projectId: ctx.projectId, name: "КУХНЯ", parentId: target.id, sortOrder: 1 },
    });
    const scene = await db.scene.create({
      data: {
        projectId: ctx.projectId,
        number: SCENE_NUMBER,
        sortOrder: 9950,
        locations: { create: [{ locationId: sourceKitchen.id }] },
      },
    });

    await page.goto(projectPath(ctx, "/locations"));
    await page.getByRole("button", { name: `Действия: ${SOURCE}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Объединить с…" }).click();
    const dialog = page.getByRole("dialog");
    // В списке — только объекты (подобъекты с объектом не объединяются).
    await expect(dialog.locator(`option[value="${targetKitchen.id}"]`)).toHaveCount(0);
    await dialog.getByLabel("С объектом").selectOption(target.id);
    const impact = dialog.getByRole("list", { name: "Что произойдёт" });
    await expect(impact).toContainText(`«${SOURCE}» исчезнет, его связи перейдут к «${TARGET}»`);
    await expect(impact).toContainText("Подобъектов перейдёт: 1");
    await expect(impact).toContainText("Одноимённых подобъектов сольётся: 1");
    await dialog.getByRole("button", { name: "Объединить", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    expect(await db.location.count({ where: { id: { in: [source.id, sourceKitchen.id] } } })).toBe(0);
    const links = await db.sceneLocation.findMany({ where: { sceneId: scene.id }, select: { locationId: true } });
    expect(links.map((l) => l.locationId)).toEqual([targetKitchen.id]);
    const facade = await db.location.findUniqueOrThrow({ where: { id: sourceFacade.id } });
    expect(facade.parentId).toBe(target.id);

    await page.reload();
    await expect(page.getByRole("link", { name: SOURCE, exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: `${TARGET}.ФАСАД`, exact: true })).toBeVisible();
  });
});
