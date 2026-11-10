import { expect, test } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Карточка сцены и либретто (волна feat/sub-objects, шаг 5). Смежная сцена «ДОМ. ДЕТСКАЯ / КОРИДОР»:
 * либретто показывает все привязки, карточка — объект и оба подобъекта, сохранение их не теряет,
 * подобъекты выбираются несколько. Сцена с двумя объектами — второй пометкой, привязка остаётся.
 */

const ctx = e2eContext();
const db = e2eDb();
const OBJECT = "Е2Е ДОМ КАРТОЧКА";
const OTHER = "Е2Е ОПУШКА КАРТОЧКА";
const NUMBERS = ["991", "992"];

async function cleanup() {
  await db.scene.deleteMany({ where: { projectId: ctx.projectId, number: { in: NUMBERS } } });
  const rows = await db.location.findMany({
    where: {
      projectId: ctx.projectId,
      OR: [{ name: { in: [OBJECT, OTHER] } }, { parent: { name: OBJECT } }],
    },
    select: { id: true, parentId: true },
  });
  await db.location.deleteMany({ where: { id: { in: rows.filter((r) => r.parentId).map((r) => r.id) } } });
  await db.location.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
}

async function linksOf(sceneId: string) {
  const links = await db.sceneLocation.findMany({ where: { sceneId }, select: { locationId: true } });
  return links.map((l) => l.locationId).sort();
}

test.describe("карточка сцены и смежные подобъекты", () => {
  test.use({ storageState: storageStatePath("producer") });
  test.beforeAll(cleanup);
  test.afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  test("«ДЕТСКАЯ / КОРИДОР»: либретто, карточка, сохранение, выбор подобъектов; два объекта", async ({ page }) => {
    const object = await db.location.create({ data: { projectId: ctx.projectId, name: OBJECT } });
    const kids = await db.location.create({
      data: { projectId: ctx.projectId, name: "ДЕТСКАЯ", parentId: object.id, sortOrder: 1 },
    });
    const hall = await db.location.create({
      data: { projectId: ctx.projectId, name: "КОРИДОР", parentId: object.id, sortOrder: 2 },
    });
    const kitchen = await db.location.create({
      data: { projectId: ctx.projectId, name: "КУХНЯ", parentId: object.id, sortOrder: 3 },
    });
    const other = await db.location.create({ data: { projectId: ctx.projectId, name: OTHER } });
    const scene = await db.scene.create({
      data: {
        projectId: ctx.projectId,
        number: NUMBERS[0]!,
        summary: "Е2Е смежная сцена",
        sortOrder: 9910,
        locations: { create: [{ locationId: kids.id }, { locationId: hall.id }] },
      },
    });
    const twoObjects = await db.scene.create({
      data: {
        projectId: ctx.projectId,
        number: NUMBERS[1]!,
        summary: "Е2Е два объекта",
        sortOrder: 9920,
        locations: { create: [{ locationId: object.id }, { locationId: other.id }] },
      },
    });

    // Либретто: все привязки, подобъекты при объекте.
    await page.goto(projectPath(ctx, "/libretto"));
    await expect(page.getByText(`${OBJECT} · ДЕТСКАЯ / КОРИДОР`).first()).toBeVisible();
    await expect(page.getByText(`${OBJECT} / ${OTHER}`).first()).toBeVisible();

    // Карточка: объект и оба подобъекта; сохранение без правок — обе привязки.
    await page.goto(projectPath(ctx, `/libretto/${scene.id}`));
    const form = page.locator("#scene-editor-form");
    await expect(form.locator('input[name="locationId"]')).toHaveValue(object.id);
    const subInputs = form.locator('input[type="hidden"][name="subLocationIds"]');
    await expect(subInputs).toHaveCount(2);
    if (process.env.E2E_CARD_SHOT) {
      await form.getByText("Подобъекты", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: process.env.E2E_CARD_SHOT });
    }
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Сцена сохранена")).toBeVisible();
    expect(await linksOf(scene.id)).toEqual([kids.id, hall.id].sort());

    // Убрать КОРИДОР, добавить КУХНЮ.
    await form.getByRole("button", { name: "КОРИДОР ×" }).click();
    await form.getByPlaceholder("Поиск подобъекта…").fill("КУХ");
    await form.getByRole("button", { name: "КУХНЯ", exact: true }).click();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Сцена сохранена")).toBeVisible();
    await expect.poll(() => linksOf(scene.id)).toEqual([kids.id, kitchen.id].sort());

    // Два объекта: второй — пометкой, после сохранения обе привязки на месте.
    await page.goto(projectPath(ctx, `/libretto/${twoObjects.id}`));
    await expect(page.getByText(`В сцене ещё объект: ${OTHER}`)).toBeVisible();
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(page.getByText("Сцена сохранена")).toBeVisible();
    expect(await linksOf(twoObjects.id)).toEqual([object.id, other.id].sort());
  });
});
