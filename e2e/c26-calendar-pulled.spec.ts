import { expect, test, type Page } from "@playwright/test";
import { e2eDb } from "./helpers/db";
import { e2eContext, fetchRsc, projectPath, sniff, storageStatePath } from "./helpers/session";

/**
 * Волна 9, шаг 3: пробы и подготовительные дни КПП в календаре. Только для чтения, щелчок ведёт
 * на источник. Без права на источник записей нет ни на экране, ни в ответах сервера.
 */

const ctx = e2eContext();
const db = e2eDb();
const CALENDAR = projectPath(ctx, "/preproduction/calendar");
const WEEK = `${CALENDAR}?view=week&date=2026-12-07`;
const TMP = "Времянка подтягивания";
const PREP_DAY_NUMBER = 9101;
const day = (key: string) => new Date(`${key}T00:00:00.000Z`);

type Seeded = {
  planId: string;
  tapeId: string;
  selfTapeId: string;
  shootDayId: string;
  eventId: string;
  candidate: { id: string; lastName: string };
};
let seeded: Seeded;

async function cleanup() {
  await db.auditionSchedule.deleteMany({ where: { projectId: ctx.projectId, comment: { startsWith: TMP } } });
  await db.audition.deleteMany({ where: { projectId: ctx.projectId, comment: { startsWith: TMP } } });
  await db.shootDay.deleteMany({ where: { projectId: ctx.projectId, dayNumber: PREP_DAY_NUMBER } });
  await db.prepEvent.deleteMany({ where: { projectId: ctx.projectId, title: { startsWith: TMP } } });
}

test.beforeAll(async () => {
  await cleanup();
  const candidate = await db.castingCandidate.findFirstOrThrow({
    where: { projectId: ctx.projectId },
    select: { id: true, person: { select: { id: true, lastName: true } } },
  });
  const project = await db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
  const type = await db.prepEventType.findFirstOrThrow({
    where: { projectId: ctx.projectId, name: "Примерка" },
  });
  const plan = await db.auditionSchedule.create({
    data: {
      projectId: ctx.projectId,
      date: day("2026-12-08"),
      time: "10:00",
      comment: `${TMP} план`,
      candidates: { create: [{ castingCandidateId: candidate.id }] },
    },
  });
  const tape = await db.audition.create({
    data: {
      projectId: ctx.projectId,
      date: day("2026-12-09"),
      time: "15:30",
      comment: `${TMP} запись`,
      createdById: project.ownerUserId,
      actors: { create: [{ personId: candidate.person.id }] },
    },
  });
  const selfTape = await db.audition.create({
    data: {
      projectId: ctx.projectId,
      date: day("2026-12-09"),
      isSelfTape: true,
      comment: `${TMP} самопроба`,
      createdById: project.ownerUserId,
    },
  });
  const shootDay = await db.shootDay.create({
    data: {
      projectId: ctx.projectId,
      date: day("2026-12-10"),
      dayNumber: PREP_DAY_NUMBER,
      dayType: "PREP",
      prepNote: `${TMP} подготовка`,
    },
  });
  // Своё событие с кандидатом: без права на кастинг его имя не должно прийти.
  const event = await db.prepEvent.create({
    data: {
      projectId: ctx.projectId,
      title: `${TMP} примерка`,
      typeId: type.id,
      allDay: true,
      startDate: day("2026-12-11"),
      endDate: day("2026-12-11"),
      createdById: project.ownerUserId,
      participants: { create: [{ castingPersonId: candidate.person.id }] },
    },
  });
  seeded = {
    planId: plan.id,
    tapeId: tape.id,
    selfTapeId: selfTape.id,
    shootDayId: shootDay.id,
    eventId: event.id,
    candidate: { id: candidate.person.id, lastName: candidate.person.lastName },
  };
});

test.afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

/** Галочка спрятана внутри подписи: щёлкаем по подписи, как человек. */
const toggle = (page: Page, label: string) => page.getByText(label, { exact: true }).click();

const pulledLink = (page: Page, text: RegExp) => page.getByRole("link", { name: text });

test.describe("продюсер", () => {
  test.use({ storageState: storageStatePath("producer") });

  test("план, запись и подготовительный день видны и ведут на источник", async ({ page }) => {
    await page.goto(WEEK);
    const hoursTue = page.locator('[data-hours="2026-12-08"]');
    const plan = hoursTue.getByRole("link", { name: /План проб/ });
    await expect(plan).toContainText(`Пробы: ${seeded.candidate.lastName}`);
    await expect(plan).toHaveAttribute("href", projectPath(ctx, "/preproduction/auditions"));

    const tape = page.locator('[data-hours="2026-12-09"]').getByRole("link", { name: /Запись пробы/ });
    await expect(tape).toHaveAttribute("href", projectPath(ctx, `/preproduction/auditions/${seeded.tapeId}`));
    // Самопроба — не встреча: в календаре её нет.
    await expect(pulledLink(page, new RegExp(`${TMP} самопроба`))).toHaveCount(0);

    const prep = page.locator('[data-allday="2026-12-10"]').getByRole("link", { name: /Подготовительный день/ });
    await expect(prep).toContainText(`День ${PREP_DAY_NUMBER}: ${TMP} подготовка`);
    await expect(prep).toHaveAttribute("href", projectPath(ctx, "/schedule"));
    if (process.env.E2E_STATE_SHOTS) {
      await page.screenshot({ path: `${process.env.E2E_STATE_SHOTS}/calendar-pulled-week.png` });
    }

    await tape.click();
    await expect(page).toHaveURL(new RegExp(`/preproduction/auditions/${seeded.tapeId}$`));
  });

  test("переключатели убирают источник, состояние в адресе", async ({ page }) => {
    await page.goto(WEEK);
    await toggle(page, "Пробы");
    await expect(page).toHaveURL(/auditions=0/);
    await expect(pulledLink(page, /План проб|Запись пробы/)).toHaveCount(0);
    await expect(pulledLink(page, /Подготовительный день/)).toHaveCount(1);

    // Переход на другую неделю переключатель не сбрасывает.
    await page.getByRole("link", { name: "Вперёд" }).click();
    await expect(page).toHaveURL(/auditions=0/);
    await page.getByRole("link", { name: "Назад" }).click();

    await toggle(page, "Подготовительные дни КПП");
    await expect(page).toHaveURL(/kpp=0/);
    await expect(pulledLink(page, /Подготовительный день/)).toHaveCount(0);

    await toggle(page, "Пробы");
    await expect(page).not.toHaveURL(/auditions=0/);
    await expect(pulledLink(page, /План проб/)).toHaveCount(1);
  });

  test("в списке и месяце подтянутые записи тоже есть", async ({ page }) => {
    await page.goto(`${CALENDAR}?view=list&date=2026-12-01`);
    await expect(pulledLink(page, /План проб/)).toContainText("10:00–11:00");
    await page.goto(`${CALENDAR}?view=month&date=2026-12-01`);
    await expect(page.locator('[data-day="2026-12-10"]').getByRole("link", { name: /Подготовительный день/ })).toBeVisible();
  });
});

test.describe("без права на кастинг", () => {
  test.use({ storageState: storageStatePath("nocast") });

  test("проб нет ни на экране, ни в ответах; кандидат — только числом", async ({ page }) => {
    const sniffer = sniff(page);
    await page.goto(WEEK);
    await expect(page.locator('[data-allday="2026-12-11"]')).toContainText(`${TMP} примерка`);
    await expect(pulledLink(page, /План проб|Запись пробы/)).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: "Пробы" })).toHaveCount(0);
    // Без вызывных у этой роли нет и КПП.
    await expect(page.getByRole("checkbox", { name: "Подготовительные дни КПП" })).toHaveCount(0);

    await page.goto(`${CALENDAR}?view=list&date=2026-12-01`);
    await expect(page.getByText("+1 кандидат", { exact: true })).toBeVisible();

    const rsc = await fetchRsc(page, WEEK);
    const bodies = [...(await sniffer.done()).map((c) => c.body), rsc.body];
    for (const body of bodies) {
      expect(body).not.toContain(seeded.candidate.lastName);
      expect(body).not.toContain(seeded.candidate.id);
      expect(body).not.toContain("auditionPlan");
      expect(body).not.toContain("auditionTape");
      expect(body).not.toContain(`${TMP} подготовка`);
    }
  });

  test("адрес с включёнными источниками ничего не добавляет", async ({ page }) => {
    const rsc = await fetchRsc(page, `${WEEK}&auditions=1&kpp=1`);
    expect(rsc.body).not.toContain("auditionPlan");
    expect(rsc.body).not.toContain("kppPrep");
  });
});
