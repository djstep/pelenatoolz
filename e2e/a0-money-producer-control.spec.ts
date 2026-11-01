import { expect, test } from "@playwright/test";
import { NAMES } from "./fixtures/data";
import { findLeaks, workbookText } from "./helpers/leaks";
import { dayId, e2eContext, fetchRsc, projectPath, storageStatePath } from "./helpers/session";

/**
 * Контроль поиска: у продюсера те же суммы на месте. Если здесь пусто — поиск в тестах
 * роли без финансов ничего бы не нашёл, и их «зелёный» ничего не значит.
 */

const ctx = e2eContext();
const day1 = dayId(ctx, 1);

test.use({ storageState: storageStatePath("producer") });

test("продюсер видит ставки: отчёт смены, персонаж, объект, позиция ресурса, кастинг", async ({ page }) => {
  for (const [path, marker] of [
    [projectPath(ctx, `/reports/${day1}`), NAMES.actor.lastName],
    [projectPath(ctx, `/characters/${ctx.characterId}`), "Требования к роли"],
    [projectPath(ctx, `/locations/${ctx.locationId}`), NAMES.location],
    [projectPath(ctx, `/settings/resources/${ctx.vehicle.categoryId}/items/${ctx.vehicle.itemId}`), NAMES.vehicle],
    [projectPath(ctx, `/preproduction/casting/${ctx.castingPersonId}`), NAMES.castingPerson.lastName],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(marker).first()).toBeVisible();
    const rsc = await fetchRsc(page, path);
    const found = findLeaks(path, rsc.body);
    expect(found.length, `${path}: суммы продюсеру видны`).toBeGreaterThan(0);
  }
});

test("продюсер: в редакторе спецтранспорта есть ставка за км", async ({ page }) => {
  await page.goto(projectPath(ctx, `/call-sheets/${day1}`));
  await expect(page.getByText(NAMES.transport).first()).toBeVisible();
  const rsc = await fetchRsc(page, projectPath(ctx, `/call-sheets/${day1}`));
  expect(findLeaks("call sheet", rsc.body).map((l) => l.what)).toContain("transportKmRate=58.61");
  // На листе ставки нет ни у кого.
  const xlsx = await page.request.get(`/api/projects/${ctx.projectId}/call-sheets/${day1}/xlsx`);
  expect(findLeaks("xlsx", await workbookText(await xlsx.body()))).toEqual([]);
});
