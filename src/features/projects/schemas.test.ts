import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createProjectSchema, invalidProjectMessage } from "./schemas";

const base = { name: "Проект", type: "FEATURE" };

describe("плановая выработка", () => {
  test("04:30 принимается как 270 минут", () => {
    const parsed = createProjectSchema.safeParse({ ...base, plannedDailyOutputMin: "04:30" });
    assert.ok(parsed.success);
    assert.equal(parsed.data.plannedDailyOutputMin, 270);
  });

  test("больше суток — отказ именно по этому полю", () => {
    const parsed = createProjectSchema.safeParse({ ...base, plannedDailyOutputMin: "43:00" });
    assert.ok(!parsed.success);
    assert.deepEqual(Object.keys(parsed.error.flatten().fieldErrors), ["plannedDailyOutputMin"]);
  });
});

describe("текст отказа", () => {
  test("называет поля по-русски", () => {
    assert.equal(
      invalidProjectMessage(["plannedDailyOutputMin", "name"]),
      "Проверьте данные проекта: Плановая выработка (до 24 часов), Название",
    );
  });

  test("без полей остаётся общим", () => {
    assert.equal(invalidProjectMessage([]), "Проверьте данные проекта");
  });
});
