import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { daysOverlap, timesOverlap } from "@/features/prep-calendar/lib/overlap";

const t = (time: string) => new Date(`2026-12-01T${time}:00Z`);

describe("пересечение по времени", () => {
  test("накладываются — да, встык — нет", () => {
    assert.equal(timesOverlap(t("10:00"), t("11:00"), t("10:30"), t("12:00")), true);
    assert.equal(timesOverlap(t("10:00"), t("11:00"), t("11:00"), t("12:00")), false);
    assert.equal(timesOverlap(t("10:00"), t("11:00"), t("09:00"), t("10:00")), false);
  });

  test("одно внутри другого и момент внутри отрезка", () => {
    assert.equal(timesOverlap(t("09:00"), t("18:00"), t("12:00"), t("13:00")), true);
    assert.equal(timesOverlap(t("12:00"), t("12:00"), t("11:00"), t("13:00")), true);
  });
});

describe("пересечение по дням", () => {
  test("общий день — да, соседние дни — нет", () => {
    assert.equal(daysOverlap("2026-12-01", "2026-12-03", "2026-12-03", "2026-12-05"), true);
    assert.equal(daysOverlap("2026-12-01", "2026-12-02", "2026-12-03", "2026-12-05"), false);
    assert.equal(daysOverlap("2026-12-04", "2026-12-04", "2026-12-01", "2026-12-10"), true);
  });
});
