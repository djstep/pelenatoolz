import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeContractVat,
  vatRateChoice,
  vatRateCustom,
} from "@/features/contracts/lib/vat";
import {
  CERTIFICATE_COLUMNS,
  CONTRACT_COLUMNS,
} from "@/features/contracts/lib/table-columns";
import {
  certificateFormSchema,
  contractFormSchema,
} from "@/features/contracts/schemas";

describe("налог договора и акта: расчёт", () => {
  test("налог выключен — суммы без налога", () => {
    assert.deepEqual(
      computeContractVat({ amount: 1000, vatEnabled: false, vatRate: 6 }),
      { vatAmount: null, amountWithVat: 1000 },
    );
  });

  test("ставка не задана — налог пустой, 22% не подставляется", () => {
    assert.deepEqual(
      computeContractVat({ amount: 1000, vatEnabled: true, vatRate: null }),
      { vatAmount: null, amountWithVat: 1000 },
    );
    assert.deepEqual(
      computeContractVat({ amount: 1000, vatEnabled: true }),
      { vatAmount: null, amountWithVat: 1000 },
    );
  });

  test("ставка задана — налог от суммы с округлением до копеек", () => {
    assert.deepEqual(
      computeContractVat({ amount: 1234.56, vatEnabled: true, vatRate: 6 }),
      { vatAmount: 74.07, amountWithVat: 1308.63 },
    );
  });

  test("налог вручную важнее ставки", () => {
    assert.deepEqual(
      computeContractVat({
        amount: 1000,
        vatEnabled: true,
        vatRate: 6,
        vatAmountManual: 100,
      }),
      { vatAmount: 100, amountWithVat: 1100 },
    );
  });
});

describe("налог договора и акта: выбор ставки в форме", () => {
  test("ставка не задана — пусто, а не 22%", () => {
    assert.equal(vatRateChoice(null), "");
    assert.equal(vatRateChoice(undefined), "");
    assert.equal(vatRateCustom(null), "");
  });

  test("ставка из списка и своя ставка", () => {
    assert.equal(vatRateChoice(7), "7");
    assert.equal(vatRateChoice(6), "custom");
    assert.equal(vatRateCustom(6), "6");
  });
});

describe("налог договора и акта: проверка формы", () => {
  const ids = {
    companyId: "ckcompany0000000000000001",
    counterpartyId: "ckcounterparty00000000001",
    statusId: "ckstatus00000000000000001",
  };
  const contract = (tax: Record<string, unknown>) =>
    contractFormSchema.safeParse({
      date: "2026-11-09",
      number: "Д-1",
      amount: 1000,
      ...ids,
      ...tax,
    });
  const certificate = (tax: Record<string, unknown>) =>
    certificateFormSchema.safeParse({
      date: "2026-11-09",
      number: "А-1",
      amount: 1000,
      ...ids,
      ...tax,
    });

  for (const [name, parse] of [
    ["договор", contract],
    ["акт", certificate],
  ] as const) {
    test(`${name}: налог включён без ставки и суммы — ошибка`, () => {
      const parsed = parse({ vatEnabled: true, vatRate: null, vatAmountManual: null });
      assert.equal(parsed.success, false);
      assert.equal(
        parsed.error?.issues[0]?.message,
        "Укажите налог: ставку % или сумму",
      );
    });

    test(`${name}: налог выключен, со ставкой или с суммой — можно`, () => {
      assert.equal(parse({ vatEnabled: false }).success, true);
      assert.equal(parse({ vatEnabled: true, vatRate: 6 }).success, true);
      assert.equal(parse({ vatEnabled: true, vatAmountManual: 60 }).success, true);
    });
  }
});

describe("договоры и акты: в колонках нет «НДС»", () => {
  test("подписи колонок таблиц", () => {
    for (const col of [...CONTRACT_COLUMNS, ...CERTIFICATE_COLUMNS]) {
      assert.doesNotMatch(col.label, /НДС/);
    }
  });
});
