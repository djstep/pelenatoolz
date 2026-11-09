import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SYSTEM_FINANCE_VARIABLES } from "@/features/finance/lib/variables";
import {
  DEFAULT_COUNTERPARTY_PAYMENT_FORMS,
  DEFAULT_EXPENSE_TYPES,
  DEFAULT_PAYMENT_FORMS,
} from "@/features/smeta/lib/budget-defaults";

const migration = readFileSync(
  "prisma/migrations/20261109120000_smeta_items/migration.sql",
  "utf8",
);

/** Кортежи VALUES из блока миграции, который начинается с `start`. */
function valuesAfter(start: string): string[][] {
  const from = migration.indexOf(start);
  assert.ok(from >= 0, `в миграции нет блока ${start}`);
  const block = migration.slice(from, migration.indexOf(";", from));
  return [...block.matchAll(/^\s+\(([^()]+)\),?$/gm)].map(([, tuple]) =>
    tuple.split(",").map((part) => part.trim().replace(/^'(.*)'$/, "$1")),
  );
}

describe("справочники сметы: код и миграция совпадают", () => {
  test("типы расходов", () => {
    assert.deepEqual(
      valuesAfter('INSERT INTO "ProjectExpenseType"'),
      DEFAULT_EXPENSE_TYPES.map((t, order) => [t.key, t.name, String(order)]),
    );
  });

  test("формы оплаты с процентом налога", () => {
    assert.deepEqual(
      valuesAfter('INSERT INTO "ProjectPaymentForm"'),
      DEFAULT_PAYMENT_FORMS.map((f, order) => [
        f.key,
        f.name,
        String(f.defaultTaxPercent),
        String(order),
      ]),
    );
  });

  test("тип контрагента → форма оплаты", () => {
    assert.deepEqual(
      valuesAfter('INSERT INTO "ProjectCounterpartyPaymentForm"'),
      DEFAULT_COUNTERPARTY_PAYMENT_FORMS.map((m) => [m.counterpartyType, m.paymentFormKey]),
    );
  });

  test("системные переменные — все четыре, значения пустые", () => {
    assert.deepEqual(
      valuesAfter('INSERT INTO "ProjectFinanceVariable"'),
      SYSTEM_FINANCE_VARIABLES.map((v) => [v.key, v.label, String(v.sortOrder)]),
    );
    assert.deepEqual(
      SYSTEM_FINANCE_VARIABLES.map((v) => v.label),
      ["СМЕНЫ", "СЕРИИ", "ДНИ ПОДГОТОВКИ", "НЕДЕЛИ"],
    );
  });
});

describe("справочники сметы: состав", () => {
  test("десять типов расходов из задания, без повторов", () => {
    assert.equal(DEFAULT_EXPENSE_TYPES.length, 10);
    assert.equal(new Set(DEFAULT_EXPENSE_TYPES.map((t) => t.name)).size, 10);
    assert.equal(new Set(DEFAULT_EXPENSE_TYPES.map((t) => t.key)).size, 10);
  });

  test("каждый тип контрагента сопоставлен существующей форме оплаты", () => {
    const keys = new Set(DEFAULT_PAYMENT_FORMS.map((f) => f.key));
    for (const m of DEFAULT_COUNTERPARTY_PAYMENT_FORMS) {
      assert.ok(keys.has(m.paymentFormKey), m.paymentFormKey);
    }
    assert.deepEqual(
      DEFAULT_COUNTERPARTY_PAYMENT_FORMS.map((m) => m.counterpartyType).sort(),
      ["INDIVIDUAL", "IP", "LEGAL_ENTITY", "SELF_EMPLOYED"],
    );
  });

  test("нигде нет НДС", () => {
    for (const f of DEFAULT_PAYMENT_FORMS) assert.doesNotMatch(f.name, /НДС/);
    assert.doesNotMatch(migration, /НДС/);
  });
});
