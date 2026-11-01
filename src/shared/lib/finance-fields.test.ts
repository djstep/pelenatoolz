import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const FIELDS = {
  open: ["id", "name"],
  finance: ["rate"],
} as const;

const row = { id: "a1", name: "Иванов", rate: 5000, secret: "в списке нет" };

describe("pickFinanceFields", () => {
  test("без права фин. поля нет совсем", () => {
    const out = pickFinanceFields(row, FIELDS, false);
    assert.deepEqual(out, { id: "a1", name: "Иванов" });
    assert.equal("rate" in out, false);
    assert.equal(JSON.stringify(out).includes("5000"), false);
  });

  test("с правом фин. поле есть", () => {
    assert.deepEqual(pickFinanceFields(row, FIELDS, true), {
      id: "a1",
      name: "Иванов",
      rate: 5000,
    });
  });

  test("поле не из списка не уходит даже с правом", () => {
    const out = pickFinanceFields(row, FIELDS, true);
    assert.equal("secret" in out, false);
  });

  test("отсутствующее поле не появляется как undefined, исходная строка не меняется", () => {
    const partial = { id: "a2", name: "Петров" } as { id: string; name: string; rate?: number };
    const out = pickFinanceFields(partial, FIELDS, true);
    assert.deepEqual(Object.keys(out), ["id", "name"]);
    assert.deepEqual(row, { id: "a1", name: "Иванов", rate: 5000, secret: "в списке нет" });
  });
});
