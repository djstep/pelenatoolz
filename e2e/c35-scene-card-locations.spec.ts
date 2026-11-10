import { expect, test } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Карточка сцены (волна feat/sub-objects): у смежной сцены «ДОМ. ДЕТСКАЯ / КОРИДОР» две привязки,
 * карточка пока показывает одну. Сохранение карточки не должно терять вторую.
 */

const ctx = e2eContext();
const db = e2eDb();
const OBJECT = "Е2Е ДОМ КАРТОЧКА";
const SCENE_NUMBER = "991";

async function cleanup() {
  await db.scene.deleteMany({ where: { projectId: ctx.projectId, number: SCENE_NUMBER } });
  const rows = await db.location.findMany({
    where: { projectId: ctx.projectId, OR: [{ name: OBJECT }, { parent: { name: OBJECT } }] },
    select: { id: true, parentId: true },
  });
  await db.location.deleteMany({ where: { id: { in: rows.filter((r) => r.parentId).map((r) => r.id) } } });
  await db.location.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

test.describe("карточка сцены и смежные подобъекты", () => {
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  test("«ДЕТСКАЯ / КОРИДОР»: после сохранения карточки обе привязки на месте", async ({ page }) => {
    const object = await db.location.create({ data: { projectId: ctx.projectId, name: OBJECT } });
    const kids = await db.location.create({
      data: { projectId: ctx.projectId, name: "ДЕТСКАЯ", parentId: object.id, sortOrder: 1 },
    });
    const hall = await db.location.create({
      data: { projectId: ctx.projectId, name: "КОРИДОР", parentId: object.id, sortOrder: 2 },
    });
    const scene = await db.scene.create({
      data: {
        projectId: ctx.projectId,
        number: SCENE_NUMBER,
        summary: "Е2Е смежная сцена",
        sortOrder: 9910,
        locations: { create: [{ locationId: kids.id }, { locationId: hall.id }] },
      },
    });

    await page.goto(projectPath(ctx, `/libretto/${scene.id}`));
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Сцена сохранена")).toBeVisible();

    const links = await db.sceneLocation.findMany({ where: { sceneId: scene.id }, select: { locationId: true } });
    expect(links.map((l) => l.locationId).sort()).toEqual([kids.id, hall.id].sort());
  });
});
