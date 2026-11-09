import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatPercent,
  parseOptionalPercent,
  parseOptionalVariableValue,
  parseRequiredPercent,
} from "@/features/finance/lib/percent";
import { taxDefaultFields } from "@/features/contracts/lib/tax-default";

describe("процент из поля формы", () => {
  test("пусто — нет значения, а не 0", () => {
    assert.deepEqual(parseOptionalPercent(""), { ok: true, value: null });
    assert.deepEqual(parseOptionalPercent("   "), { ok: true, value: null });
    assert.deepEqual(parseOptionalPercent(null), { ok: true, value: null });
  });

  test("число, запятая, границы", () => {
    assert.deepEqual(parseOptionalPercent("6"), { ok: true, value: 6 });
    assert.deepEqual(parseOptionalPercent("6,5"), { ok: true, value: 6.5 });
    assert.deepEqual(parseOptionalPercent("0"), { ok: true, value: 0 });
    assert.deepEqual(parseOptionalPercent("100"), { ok: true, value: 100 });
  });

  test("не число и вне 0–100 — ошибка", () => {
    for (const bad of ["abc", "-1", "100.01", "1e2", "6%", "6.12345"]) {
      assert.deepEqual(parseOptionalPercent(bad), { ok: false }, bad);
    }
  });

  test("обязательный процент: пусто — ошибка", () => {
    assert.deepEqual(parseRequiredPercent(""), { ok: false });
    assert.deepEqual(parseRequiredPercent("5"), { ok: true, value: 5 });
  });

  test("показ: «—» для пустого", () => {
    assert.equal(formatPercent(null), "—");
    assert.equal(formatPercent(6), "6 %");
    assert.equal(formatPercent(6.5), "6,5 %");
  });
});

describe("значение переменной из поля формы", () => {
  test("пусто — не задано (null), а не 0", () => {
    assert.deepEqual(parseOptionalVariableValue(""), { ok: true, value: null });
    assert.deepEqual(parseOptionalVariableValue(null), { ok: true, value: null });
  });

  test("число от 0, запятая", () => {
    assert.deepEqual(parseOptionalVariableValue("32"), { ok: true, value: 32 });
    assert.deepEqual(parseOptionalVariableValue("2,5"), { ok: true, value: 2.5 });
    assert.deepEqual(parseOptionalVariableValue("-1"), { ok: false });
    assert.deepEqual(parseOptionalVariableValue("x"), { ok: false });
  });
});

describe("налог по умолчанию в договоре и акте", () => {
  test("тип контрагента не сопоставлен — налог выключен, поля пустые", () => {
    assert.deepEqual(taxDefaultFields({ mapped: false }), {
      vatEnabled: false,
      vatRate: "",
      vatManual: "",
    });
  });

  test("форма с процентом — налог включён с этой ставкой", () => {
    assert.deepEqual(taxDefaultFields({ mapped: true, rate: 6 }), {
      vatEnabled: true,
      vatRate: "6",
      vatManual: "",
    });
  });

  test("форма без процента — налог включён, ставку вводят руками", () => {
    assert.deepEqual(taxDefaultFields({ mapped: true, rate: null }), {
      vatEnabled: true,
      vatRate: "",
      vatManual: "",
    });
  });
});
