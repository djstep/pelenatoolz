import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma, type Project } from "@prisma/client";
import { projectSettingsValues } from "./project-settings-values";

const base = {
  id: "p1",
  name: "Проект",
  pageToMinuteRatio: new Prisma.Decimal("1.25"),
  plannedDailyOutputMin: new Prisma.Decimal("480.00"),
  filmCoefficient: null,
  startDate: new Date("2026-09-01T00:00:00Z"),
} as unknown as Project;

describe("projectSettingsValues — без Decimal в клиентский компонент", () => {
  it("Decimal → число, пустое — null, остальное как есть", () => {
    const v = projectSettingsValues(base);
    assert.equal(v.pageToMinuteRatio, 1.25);
    assert.equal(v.plannedDailyOutputMin, 480);
    assert.equal(v.filmCoefficient, null);
    assert.equal(v.name, "Проект");
    assert.ok(v.startDate instanceof Date);
  });

  it("ни одного Decimal в значениях", () => {
    const v = projectSettingsValues({ ...base, filmCoefficient: new Prisma.Decimal("0.5") } as Project);
    assert.equal(v.filmCoefficient, 0.5);
    for (const [key, value] of Object.entries(v)) {
      assert.ok(!Prisma.Decimal.isDecimal(value), `${key} — Decimal`);
    }
  });
});
