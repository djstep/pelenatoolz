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
const mappingMigration = readFileSync(
  "prisma/migrations/20261109140000_counterparty_mapping_defaults/migration.sql",
  "utf8",
);
const defaultsMigration = readFileSync(
  "prisma/migrations/20261109130000_payment_form_defaults/migration.sql",
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

  test("формы оплаты с процентом налога (после миграции, очистившей проценты)", () => {
    const cleared = new Set(
      [...defaultsMigration.matchAll(/^\s+\('([A-Z_]+)', [\d.]+::numeric\),?$/gm)].map(([, key]) => key),
    );
    const effective = valuesAfter('INSERT INTO "ProjectPaymentForm"').map(([key, name, percent, order]) => [
      key,
      name,
      cleared.has(key) ? null : Number(percent),
      Number(order),
    ]);
    assert.deepEqual(
      effective,
      DEFAULT_PAYMENT_FORMS.map((f, order) => [f.key, f.name, f.defaultTaxPercent, order]),
    );
    assert.deepEqual(
      DEFAULT_PAYMENT_FORMS.map((f) => f.defaultTaxPercent),
      [6, 6, null, null, null],
    );
  });

  test("тип контрагента → форма оплаты (после миграции, снявшей юрлицо и ГПХ)", () => {
    const removed = new Set(
      [...mappingMigration.matchAll(/^\s+\('([A-Z_]+)', '([A-Z_]+)'\),?$/gm)].map(([, type, key]) => `${type}:${key}`),
    );
    assert.equal(removed.size, 2);
    const effective = valuesAfter('INSERT INTO "ProjectCounterpartyPaymentForm"').filter(
      ([type, key]) => !removed.has(`${type}:${key}`),
    );
    assert.deepEqual(
      effective,
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

  test("сопоставление ссылается на существующие формы оплаты", () => {
    const keys = new Set(DEFAULT_PAYMENT_FORMS.map((f) => f.key));
    for (const m of DEFAULT_COUNTERPARTY_PAYMENT_FORMS) {
      assert.ok(keys.has(m.paymentFormKey), m.paymentFormKey);
    }
    // Юрлицо и физлицо (ГПХ) не сопоставлены: налог по умолчанию выключен.
    assert.deepEqual(
      DEFAULT_COUNTERPARTY_PAYMENT_FORMS.map((m) => m.counterpartyType).sort(),
      ["IP", "SELF_EMPLOYED"],
    );
  });

  test("нигде нет НДС", () => {
    for (const f of DEFAULT_PAYMENT_FORMS) assert.doesNotMatch(f.name, /НДС/);
    assert.doesNotMatch(migration, /НДС/);
  });
});
