import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  calcItem,
  multipliersOf,
  sumCalcs,
  sumTotals,
  type ItemCalc,
  type VariableValues,
} from "@/features/smeta/lib/item-calc";
import { isId, lineCode, parseDecimal, parseLineInput } from "@/features/smeta/lib/item-input";

const NO_VARS: VariableValues = new Map();
const s = (c: ItemCalc) => ({
  amount: c.amount?.toFixed(2) ?? null,
  tax: c.tax?.toFixed(2) ?? null,
  total: c.total?.toFixed(2) ?? null,
  problems: c.problems,
});

describe("строка сметы: расчёт", () => {
  test("без множителей и налога: Кол-во × Ставка", () => {
    assert.deepEqual(s(calcItem({ quantity: 2, rate: "1500", multipliers: [], taxPercent: null }, NO_VARS)), {
      amount: "3000.00",
      tax: "0.00",
      total: "3000.00",
      problems: [],
    });
  });

  test("множители: переменная и своё число, до трёх", () => {
    const vars: VariableValues = new Map<string, string | number | null>([["smeny", "32"], ["serii", 8]]);
    const c = calcItem(
      {
        quantity: "1",
        rate: "1000",
        multipliers: [{ variableId: "smeny" }, { value: "1.5" }, { variableId: "serii" }],
        taxPercent: "6",
      },
      vars,
    );
    // 1 × 1000 × 32 × 1,5 × 8 = 384 000; налог 6 % = 23 040.
    assert.deepEqual(s(c), { amount: "384000.00", tax: "23040.00", total: "407040.00", problems: [] });
  });

  test("округление до копеек: сумма и налог отдельно, половина — вверх", () => {
    // 3 × 33,33 × 1,005 = 100,48995 → 100,49; налог 6 % = 6,0294 → 6,03.
    const c = calcItem({ quantity: 3, rate: "33.33", multipliers: [{ value: "1.005" }], taxPercent: "6" }, NO_VARS);
    assert.deepEqual(s(c), { amount: "100.49", tax: "6.03", total: "106.52", problems: [] });
    // Ровно половина копейки: 0,125 → 0,13.
    const half = calcItem({ quantity: "0.125", rate: "1", multipliers: [], taxPercent: null }, NO_VARS);
    assert.equal(half.amount?.toFixed(2), "0.13");
  });

  test("Decimal без ошибок двоичной дроби: 0,1 × 3 = 0,30", () => {
    const c = calcItem({ quantity: "3", rate: "0.1", multipliers: [], taxPercent: null }, NO_VARS);
    assert.equal(c.amount?.toFixed(2), "0.30");
  });

  test("пустая переменная-множитель — суммы нет, пометка, не ноль", () => {
    const vars: VariableValues = new Map<string, string | null>([["nedeli", null]]);
    const c = calcItem({ quantity: 1, rate: 100, multipliers: [{ variableId: "nedeli" }], taxPercent: "6" }, vars);
    assert.deepEqual(s(c), {
      amount: null,
      tax: null,
      total: null,
      problems: [{ kind: "variable_missing", variableId: "nedeli" }],
    });
  });

  test("удалённая (неизвестная) переменная — тоже пометка", () => {
    const c = calcItem({ quantity: 1, rate: 100, multipliers: [{ variableId: "gone" }], taxPercent: null }, NO_VARS);
    assert.equal(c.amount, null);
    assert.deepEqual(c.problems, [{ kind: "variable_missing", variableId: "gone" }]);
  });

  test("не заполнены количество или ставка — суммы нет, пометка", () => {
    const c = calcItem({ quantity: null, rate: null, multipliers: [], taxPercent: null }, NO_VARS);
    assert.equal(c.total, null);
    assert.deepEqual(c.problems, [{ kind: "no_quantity" }, { kind: "no_rate" }]);
  });

  test("нулевая переменная — сумма 0 (значение задано), без пометки", () => {
    const c = calcItem({ quantity: 1, rate: 100, multipliers: [{ variableId: "x" }], taxPercent: null }, new Map([["x", 0]]));
    assert.equal(c.amount?.toFixed(2), "0.00");
    assert.deepEqual(c.problems, []);
  });
});

describe("итоги уровней", () => {
  test("итог — сумма округлённых строк; строки без суммы считаются отдельно", () => {
    const lines = [
      calcItem({ quantity: 1, rate: "0.005", multipliers: [], taxPercent: null }, NO_VARS), // 0,01
      calcItem({ quantity: 1, rate: "0.005", multipliers: [], taxPercent: null }, NO_VARS), // 0,01
      calcItem({ quantity: null, rate: 10, multipliers: [], taxPercent: null }, NO_VARS), // нет суммы
    ];
    const t = sumCalcs(lines);
    // Сумма округлённых строк: 0,02 (а не 0,01 от 0,010).
    assert.equal(t.amount.toFixed(2), "0.02");
    assert.equal(t.incomplete, 1);
  });

  test("итог статьи — из итогов подстатей", () => {
    const a = sumCalcs([calcItem({ quantity: 1, rate: 100, multipliers: [], taxPercent: "6" }, NO_VARS)]);
    const b = sumCalcs([calcItem({ quantity: 2, rate: 50, multipliers: [], taxPercent: null }, NO_VARS)]);
    const t = sumTotals([a, b]);
    assert.equal(t.amount.toFixed(2), "200.00");
    assert.equal(t.tax.toFixed(2), "6.00");
    assert.equal(t.total.toFixed(2), "206.00");
    assert.equal(t.incomplete, 0);
  });

  test("множители из колонок базы", () => {
    assert.deepEqual(
      multipliersOf({
        multiplier1VariableId: "v",
        multiplier1Value: null,
        multiplier2VariableId: null,
        multiplier2Value: "2",
        multiplier3VariableId: null,
        multiplier3Value: null,
      }),
      [{ variableId: "v" }, { value: "2" }, null],
    );
  });
});

describe("строка сметы: проверка ввода", () => {
  test("числа: запятая, пробелы, пусто — null, лишние знаки и минус — ошибка", () => {
    assert.deepEqual(parseDecimal("1 500,5", 2, 1e12), { ok: true, value: "1500.5" });
    assert.deepEqual(parseDecimal("", 2, 1e12), { ok: true, value: null });
    assert.deepEqual(parseDecimal(null, 2, 1e12), { ok: true, value: null });
    assert.deepEqual(parseDecimal("1.234", 2, 1e12), { ok: false });
    assert.deepEqual(parseDecimal("1.2300", 2, 1e12), { ok: true, value: "1.23" });
    assert.deepEqual(parseDecimal("-1", 2, 1e12), { ok: false });
    assert.deepEqual(parseDecimal("1e3", 2, 1e12), { ok: false });
    assert.deepEqual(parseDecimal("101", 4, 100), { ok: false });
    assert.deepEqual(parseDecimal({}, 2, 1e12), { ok: false });
  });

  test("полная строка", () => {
    const parsed = parseLineInput({
      name: "  Камерваген  ",
      unit: "смена",
      quantity: "1",
      rate: "15000",
      multipliers: [{ variableId: "ckvar0001" }, { value: "2" }],
      expenseTypeId: "cktype0001",
      paymentFormId: "",
      taxPercent: "6",
    });
    assert.deepEqual(parsed, {
      ok: true,
      value: {
        name: "Камерваген",
        unit: "смена",
        quantity: "1",
        rate: "15000",
        multipliers: [{ variableId: "ckvar0001" }, { value: "2" }, null],
        expenseTypeId: "cktype0001",
        paymentFormId: null,
        taxPercent: "6",
      },
    });
  });

  test("налог не прислан — undefined (возьмётся из формы оплаты)", () => {
    const parsed = parseLineInput({ name: "Строка" });
    assert.equal(parsed.ok && parsed.value.taxPercent, undefined);
  });

  test("ошибки: без названия, больше трёх множителей, переменная и число сразу, налог больше 100, не те типы", () => {
    assert.equal(parseLineInput({ name: "  " }).ok, false);
    assert.equal(parseLineInput({ name: "x", multipliers: [null, null, null, null] }).ok, false);
    assert.equal(parseLineInput({ name: "x", multipliers: [{ variableId: "a", value: "2" }] }).ok, false);
    assert.equal(parseLineInput({ name: "x", taxPercent: "120" }).ok, false);
    assert.equal(parseLineInput({ name: "x", paymentFormId: 42 }).ok, false);
    assert.equal(parseLineInput("строка").ok, false);
  });

  test("id и код строки", () => {
    assert.equal(isId("ck123"), true);
    assert.equal(isId(""), false);
    assert.equal(isId(123), false);
    assert.equal(lineCode("TR", 5, 2, 3), "TR-05.02.03");
    assert.equal(lineCode("CAM", 12, 101, 7), "CAM-12.101.07");
  });
});
