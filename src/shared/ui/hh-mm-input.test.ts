import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hhMmToMinutes, isValidHhMm, normalizeHhMm } from "./hh-mm-input";

describe("длительность: то, что на экране, то и сохраняется", () => {
  test("три цифры с часами больше 23 — это Ч:ММ", () => {
    assert.equal(normalizeHhMm("430", "duration"), "04:30");
    assert.equal(normalizeHhMm("845", "duration"), "08:45");
    assert.equal(normalizeHhMm("315", "duration"), "03:15");
    assert.equal(hhMmToMinutes("430", "duration"), 270);
  });

  test("ввод с двоеточием и с ведущим нулём", () => {
    assert.equal(normalizeHhMm("04:30", "duration"), "04:30");
    assert.equal(normalizeHhMm("0430", "duration"), "04:30");
    assert.equal(hhMmToMinutes("04:30", "duration"), 270);
  });

  test("три цифры с часами до 23 — как на экране: 12:3 это 12:30", () => {
    assert.equal(normalizeHhMm("123", "duration"), "12:30");
  });

  test("больше суток вводится четырьмя цифрами", () => {
    assert.equal(normalizeHhMm("4300", "duration"), "43:00");
    assert.equal(normalizeHhMm("2430", "duration"), "24:30");
  });

  test("минуты от 60 — ошибка, а не другое значение", () => {
    assert.equal(isValidHhMm("490", "duration"), false);
    assert.equal(isValidHhMm("0475", "duration"), false);
  });
});

describe("время суток не изменилось", () => {
  test("обычные значения", () => {
    assert.equal(normalizeHhMm("820", "clock"), "08:20");
    assert.equal(normalizeHhMm("1020", "clock"), "10:20");
    assert.equal(normalizeHhMm("10:20", "clock"), "10:20");
    assert.equal(normalizeHhMm("430", "clock"), "04:30");
  });

  test("часы больше 23 — ошибка", () => {
    assert.equal(isValidHhMm("2430", "clock"), false);
  });
});
