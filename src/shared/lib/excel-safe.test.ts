import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { excelSafe, isFormulaLike } from "@/shared/lib/excel-safe";

describe("excelSafe — защита от формул в выгрузках Excel", () => {
  test("телефоны, температуры, числа со знаком — без апострофа", () => {
    for (const value of [
      "+7 921 555-01-01",
      "+7 (921) 555-01-01",
      "+6°",
      "-2°",
      "\u22122°",
      "-15,5",
      "+1/2",
      "-",
      "+",
      "Иванов",
      "",
    ]) {
      assert.equal(excelSafe(value), value, value);
      assert.equal(isFormulaLike(value), false, value);
    }
  });

  test("похожее на формулу — с апострофом", () => {
    for (const value of [
      "=1+1",
      "@SUM(A1)",
      "+cmd|' /C calc'!A0",
      "-2+3*cmd",
      "\t=1+1",
      "\tтекст",
      "\rтекст",
      "+7 921 доб. 5",
      "\u2212cmd",
      "-2°C",
    ]) {
      assert.equal(excelSafe(value), `'${value}`, JSON.stringify(value));
    }
  });

  test("не строки не трогаются, ячейки остаются текстом", () => {
    assert.equal(excelSafe(-5), -5);
    assert.equal(excelSafe(null), null);
    const date = new Date(0);
    assert.equal(excelSafe(date), date);
    assert.equal(typeof excelSafe("=1+1"), "string");
  });
});
