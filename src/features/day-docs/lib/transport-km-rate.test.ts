import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveTransportKmRates } from "@/features/day-docs/lib/transport-km-rate";

describe("resolveTransportKmRates", () => {
  const existing = [
    { name: "Автокран", kmRate: 120 },
    { name: "Генератор", kmRate: 80 },
  ];

  test("с фин. правкой — ставка из формы", () => {
    assert.deepEqual(
      resolveTransportKmRates(
        [
          { name: "Автокран", kmRate: 150 },
          { name: "Генератор", kmRate: null },
        ],
        existing,
        true,
      ),
      [150, null],
    );
  });

  test("без фин. правки — присланная ставка отбрасывается, остаётся прежняя", () => {
    assert.deepEqual(
      resolveTransportKmRates(
        [
          { name: "Генератор", kmRate: 999 },
          { name: "Автокран", kmRate: 0 },
        ],
        existing,
        false,
      ),
      [80, 120],
    );
  });

  test("без фин. правки — новая строка без ставки, даже если её прислали", () => {
    assert.deepEqual(
      resolveTransportKmRates([{ name: "Игровой автобус", kmRate: 500 }], existing, false),
      [null],
    );
  });

  test("без фин. правки — стереть ставку тоже нельзя", () => {
    assert.deepEqual(
      resolveTransportKmRates([{ name: " автокран ", kmRate: null }], existing, false),
      [120],
    );
  });

  test("одинаковые названия — каждая прежняя ставка достаётся один раз", () => {
    assert.deepEqual(
      resolveTransportKmRates(
        [{ name: "Автокран" }, { name: "Автокран" }],
        [
          { name: "Автокран", kmRate: 100 },
          { name: "Автокран", kmRate: 200 },
        ],
        false,
      ),
      [100, 200],
    );
  });
});
