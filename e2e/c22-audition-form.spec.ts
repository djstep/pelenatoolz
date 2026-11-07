import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * Форма «Добавить пробы»: обязательны только дата и файл или ссылка.
 * Кнопка не блокируется молча: если чего-то не хватает, форма говорит чего.
 */

const ctx = e2eContext();
const db = e2eDb();
const AUDITIONS = projectPath(ctx, "/preproduction/auditions");
const FILE_NAME = "e2e-проба-из-формы.mp4";
const LINK = "https://example.com/e2e-проба-ссылкой";

test.use({ storageState: storageStatePath("producer") });
test.describe.configure({ mode: "serial" });

async function openForm(page: Page) {
  await page.goto(AUDITIONS);
  await page.getByRole("button", { name: "Записи проб" }).click();
  await page.getByRole("button", { name: "+ Добавить пробу" }).click();
  return page.getByRole("dialog");
}

test.afterAll(async () => {
  await db.audition.deleteMany({
    where: {
      projectId: ctx.projectId,
      OR: [{ externalUrl: LINK }, { videoFile: { originalName: FILE_NAME } }],
    },
  });
  await db.projectFile.deleteMany({ where: { projectId: ctx.projectId, originalName: FILE_NAME } });
});

test("проба с файлом без ссылки и без актёра сохраняется", async ({ page }) => {
  const form = await openForm(page);
  await form.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME,
    mimeType: "video/mp4",
    buffer: Buffer.alloc(2048, 1),
  });
  await expect(form.getByText("Загружено", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(form).toBeHidden();

  const saved = await db.audition.findFirstOrThrow({
    where: { projectId: ctx.projectId, videoFile: { originalName: FILE_NAME } },
    select: { externalUrl: true, actors: { select: { id: true } } },
  });
  expect(saved.externalUrl).toBeNull();
  expect(saved.actors).toEqual([]);
});

test("проба со ссылкой без файла сохраняется", async ({ page }) => {
  const form = await openForm(page);
  await form.getByPlaceholder("https://…").fill(LINK);
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(form).toBeHidden();

  const saved = await db.audition.findFirstOrThrow({
    where: { projectId: ctx.projectId, externalUrl: LINK },
    select: { videoFileId: true },
  });
  expect(saved.videoFileId).toBeNull();
});

test("без файла и ссылки — отказ с понятным текстом", async ({ page }) => {
  const before = await db.audition.count({ where: { projectId: ctx.projectId } });
  const form = await openForm(page);
  const save = form.getByRole("button", { name: "Сохранить" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form.getByTestId("audition-problem")).toHaveText("Выберите файл или укажите ссылку");
  await expect(form).toBeVisible();
  expect(await db.audition.count({ where: { projectId: ctx.projectId } })).toBe(before);
});

test("файл не загрузился — видна причина, а сохранение просит другой файл или ссылку", async ({ page }) => {
  await page.route("**/uploads/video", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"Максимум 512 МБ на файл"}' }),
  );
  const form = await openForm(page);
  await form.locator('input[type="file"]').setInputFiles({
    name: "e2e-большой.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.alloc(16, 1),
  });
  await expect(form.getByText("Максимум 512 МБ на файл", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(form.getByTestId("audition-problem")).toContainText("Файл не загрузился: Максимум 512 МБ на файл");
});
