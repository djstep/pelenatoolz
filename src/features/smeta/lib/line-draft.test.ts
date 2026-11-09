import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  draftFromLine,
  draftToPayload,
  formatMoney,
  formatNumber,
  previewDraft,
  sameDraft,
} from "@/features/smeta/lib/line-draft";
import { multipliersText } from "@/features/smeta/components/budget-multipliers-modal";

const stored = {
  name: "Камерваген",
  unit: "смена",
  quantity: "1",
  rate: "15000.5",
  multipliers: [{ variableId: "smeny" }, { value: "0.7" }, null],
  expenseTypeId: "type",
  paymentFormId: "ip",
  taxPercent: "6",
};

describe("строка сметы на экране", () => {
  test("из базы в поля: запятая, пустые множители", () => {
    const d = draftFromLine(stored);
    assert.equal(d.rate, "15000,5");
    assert.deepEqual(d.slots, [
      { kind: "variable", variableId: "smeny" },
      { kind: "number", value: "0,7" },
      { kind: "none" },
    ]);
    assert.equal(sameDraft(d, draftFromLine(stored)), true);
  });

  test("в данные для сервера: пустое число-множитель — нет множителя, налог явно", () => {
    const d = draftFromLine({ ...stored, multipliers: [], taxPercent: null });
    d.slots[1] = { kind: "number", value: "  " };
    const payload = draftToPayload(d);
    assert.deepEqual(payload.multipliers, [null, null, null]);
    assert.equal(payload.taxPercent, "");
  });

  test("предпросмотр: скидка множителем 0,7 и налог", () => {
    const d = draftFromLine({ ...stored, rate: "1000", multipliers: [{ value: "0.7" }], taxPercent: "6" });
    const p = previewDraft(d, new Map());
    assert.equal(p.amount?.toFixed(2), "700.00");
    assert.equal(p.total?.toFixed(2), "742.00");
    assert.deepEqual(p.invalid, []);
  });

  test("предпросмотр: неверное число — поле помечено, суммы нет", () => {
    const d = draftFromLine(stored);
    d.quantity = "abc";
    d.taxPercent = "150";
    const p = previewDraft(d, new Map());
    assert.equal(p.total, null);
    assert.deepEqual(p.invalid, ["quantity", "taxPercent"]);
  });

  test("предпросмотр: пустая переменная — пометка, как на сервере", () => {
    const d = draftFromLine(stored);
    const p = previewDraft(d, new Map([["smeny", null]]));
    assert.equal(p.total, null);
    assert.deepEqual(p.problems, [{ kind: "variable_missing", variableId: "smeny" }]);
  });

  test("числа на экране: тысячи разделены, копейки", () => {
    assert.equal(formatMoney("1234567.8").replace(/\s/g, " "), "1 234 567,80");
    assert.equal(formatNumber("0.7"), "0,7");
    assert.equal(formatMoney(null), "");
  });

  test("множители текстом: значение переменной и «не задана»", () => {
    const vars = [
      { id: "smeny", label: "СМЕНЫ", value: "32" },
      { id: "nedeli", label: "НЕДЕЛИ", value: null },
    ];
    assert.equal(
      multipliersText(
        [{ kind: "variable", variableId: "smeny" }, { kind: "number", value: "0,7" }, { kind: "variable", variableId: "nedeli" }],
        vars,
      ),
      "× СМЕНЫ (32) × 0,7 × НЕДЕЛИ (не задана)",
    );
  });
});
