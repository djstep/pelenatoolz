import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACTOR_FIELDS,
  CAST_SNAPSHOT_FIELDS,
  CAST_SNAPSHOT_INPUT_FIELDS,
  CHARACTER_FIELDS,
} from "@/features/characters/lib/character-fields";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

const snapshot = {
  lastName: "Иванов",
  phone: "+7 900",
  skills: ["вокал"],
  riderNotes: "райдер",
  proposedRate: 15000,
  proposedTerms: "условия",
  shiftRate: 15000,
  taxPercent: 13,
};

describe("персонажи: снимок утверждённого актёра", () => {
  test("без фин. просмотра актёров в снимке нет ставки и условий", () => {
    const out = pickFinanceFields(snapshot, CAST_SNAPSHOT_FIELDS, false);
    for (const key of ["proposedRate", "proposedTerms", "shiftRate", "taxPercent"]) {
      assert.equal(key in out, false, key);
    }
    assert.equal(out.phone, "+7 900");
    assert.equal(out.riderNotes, "райдер");
  });

  test("с фин. просмотром ставка есть", () => {
    const out = pickFinanceFields(snapshot, CAST_SNAPSHOT_FIELDS, true);
    assert.equal(out.shiftRate, 15000);
    assert.equal(out.proposedTerms, "условия");
  });

  test("сырой castSnapshot персонажа в браузер не уходит никогда", () => {
    const character = { id: "ch1", name: "Герой", castSnapshot: snapshot };
    assert.equal("castSnapshot" in pickFinanceFields(character, CHARACTER_FIELDS, true), false);
  });

  test("запись снимка: ставка и условия — только с фин. правкой", () => {
    const input = { riderNotes: "р", shiftRate: 1, proposedTerms: "у" };
    assert.deepEqual(pickFinanceFields(input, CAST_SNAPSHOT_INPUT_FIELDS, false), {
      riderNotes: "р",
    });
    assert.deepEqual(pickFinanceFields(input, CAST_SNAPSHOT_INPUT_FIELDS, true), input);
  });
});

describe("карточка актёра", () => {
  const actor = {
    id: "a1",
    lastName: "Иванов",
    phone1: "+7 900",
    shiftHoursMin: 720,
    shiftRate: 15000,
    taxPercent: 13,
    specialConditions: "условия",
    defaultBudgetItemId: "b1",
    overtimeRates: [{ hourNumber: 1, amount: 2000 }],
    extraPayments: [{ amount: 500 }],
  };

  test("без фин. просмотра нет ставки, налога, переработок, доплат и статей сметы", () => {
    const out = pickFinanceFields(actor, ACTOR_FIELDS, false);
    assert.deepEqual(out, { id: "a1", lastName: "Иванов", phone1: "+7 900" });
  });

  test("с фин. просмотром всё есть", () => {
    const out = pickFinanceFields(actor, ACTOR_FIELDS, true);
    assert.equal(out.shiftRate, 15000);
    assert.equal(out.overtimeRates?.length, 1);
    assert.equal(out.extraPayments?.length, 1);
  });
});
