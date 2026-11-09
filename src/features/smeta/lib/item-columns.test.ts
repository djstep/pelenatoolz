import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACTIONS_WIDTH,
  COLUMNS,
  DEFAULT_COLUMNS,
  layoutOf,
  NAME_MIN_WIDTH,
  parseVisibleColumns,
} from "@/features/smeta/lib/item-columns";

describe("колонки сметы цеха", () => {
  test("по умолчанию: кол-во, ставка, множители, итого", () => {
    assert.deepEqual([...parseVisibleColumns(null)], ["quantity", "rate", "multipliers", "total"]);
  });

  test("из памяти: неизвестные ключи пропускаются, «Итого» — всегда", () => {
    assert.deepEqual([...parseVisibleColumns("amount,bogus,unit")].sort(), ["amount", "total", "unit"]);
    assert.deepEqual([...parseVisibleColumns("")], ["total"]);
  });

  test("раскладка: деньги отдельно, скрытые — для строки под строкой", () => {
    const layout = layoutOf(parseVisibleColumns(null));
    assert.deepEqual(layout.middle.map((c) => c.key), ["quantity", "rate", "multipliers"]);
    assert.deepEqual(layout.money.map((c) => c.key), ["total"]);
    assert.deepEqual(layout.hidden.map((c) => c.key), ["type", "unit", "paymentForm", "taxPercent", "amount", "tax"]);
    assert.equal(layout.count, 6);
  });

  test("колонки по умолчанию с названием не шире места под таблицу в 1280 px", () => {
    const fixed = COLUMNS.filter((c) => DEFAULT_COLUMNS.includes(c.key)).reduce((sum, c) => sum + c.width, 0);
    // 1280 минус меню слева и поля страницы — около 960 px.
    assert.ok(NAME_MIN_WIDTH + ACTIONS_WIDTH + fixed <= 960);
  });
});
