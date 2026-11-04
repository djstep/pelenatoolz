import { expect, test } from "@playwright/test";
import { DAYS, NAMES } from "./fixtures/data";
import { e2eDb } from "./helpers/db";
import { e2eContext, projectPath, storageStatePath } from "./helpers/session";

/**
 * КПП: занятость актёров на карточках сцен в днях (точка + слово в нижней строке).
 * Своя сцена в дне занятостью не считается; занят в календаре — «заняты», часть актёров — «частично».
 * В сиде: день 1 — сцена 1 (Иван, Мария) и сцена 2 (Иван); актёр Ивана занят только в дату дня 1.
 */

const ctx = e2eContext();
const db = e2eDb();
const DAY1 = new Date(`${DAYS[0].date}T00:00:00.000Z`);

test.use({ storageState: storageStatePath("producer") });

/** Строка актёра в календаре занятости (нет — создаём, после теста убираем). */
async function calendarRow(name: { lastName: string; firstName: string }) {
  const actor = await db.actor.findFirstOrThrow({
    where: { projectId: ctx.projectId, ...name },
    select: { id: true },
  });
  const existing = await db.actorAvailabilityRow.findFirst({
    where: { projectId: ctx.projectId, actorId: actor.id },
    select: { id: true },
  });
  if (existing) return { rowId: existing.id, created: false };
  const row = await db.actorAvailabilityRow.create({
    data: { projectId: ctx.projectId, actorId: actor.id },
    select: { id: true },
  });
  return { rowId: row.id, created: true };
}

test("занятость на карточках дней: свободны → занят в календаре → заняты и частично", async ({ page }) => {
  const { rowId, created } = await calendarRow(NAMES.actor);
  // Актёр без строки в календаре для расчёта «неизвестен»: нужна и строка Марии, иначе не «частично».
  const maria = await calendarRow(NAMES.actor2);
  const before = await db.actorAvailabilityDay.findUnique({ where: { rowId_date: { rowId, date: DAY1 } } });
  // Если от прошлого сбоя в календаре осталась занятость — старт с чистой даты.
  if (before) await db.actorAvailabilityDay.delete({ where: { id: before.id } });

  const cards = (word: string) => page.getByRole("button").filter({ hasText: word });
  try {
    await page.goto(projectPath(ctx, "/schedule"));
    await expect(page.getByText("КПП и вызывные").first()).toBeVisible();
    // Актёры стоят в этих днях сами — это не занятость.
    await expect(cards("свободны").first()).toBeVisible();
    const free = await cards("свободны").count();
    expect(free).toBeGreaterThanOrEqual(3);
    await expect(cards("заняты")).toHaveCount(0);
    await expect(cards("частично")).toHaveCount(0);

    await db.actorAvailabilityDay.create({ data: { rowId, date: DAY1, status: "BUSY_OTHER" } });
    await page.reload();
    await expect(cards("заняты")).toHaveCount(1); // сцена 2: только Иван
    await expect(cards("частично")).toHaveCount(1); // сцена 1: Иван занят, Мария свободна
    await expect(cards("свободны")).toHaveCount(free - 2); // остальные дни не изменились
  } finally {
    await db.actorAvailabilityDay.deleteMany({ where: { rowId, date: DAY1 } });
    if (before) {
      await db.actorAvailabilityDay.create({
        data: { rowId, date: DAY1, status: before.status, comment: before.comment },
      });
    }
    if (created) await db.actorAvailabilityRow.delete({ where: { id: rowId } });
    if (maria.created) await db.actorAvailabilityRow.delete({ where: { id: maria.rowId } });
  }
});
