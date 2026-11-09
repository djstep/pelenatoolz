import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeContractVat,
  vatManualInput,
  vatRateInput,
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

describe("налог договора и акта: поля формы при правке", () => {
  test("ставка: сохранённая или пусто, а не 22%", () => {
    assert.equal(vatRateInput(null), "");
    assert.equal(vatRateInput(undefined), "");
    assert.equal(vatRateInput(6), "6");
    assert.equal(vatRateInput(4.5), "4.5");
  });

  test("налог введён суммой без ставки — «Налог вручную» заполнен", () => {
    assert.equal(
      vatManualInput({ amount: 1000, vatEnabled: true, vatRate: null, vatAmount: 60 }),
      "60",
    );
  });

  test("сумма налога не сходится со ставкой (старые записи) — тоже вручную", () => {
    assert.equal(
      vatManualInput({ amount: 1000, vatEnabled: true, vatRate: 22, vatAmount: 100 }),
      "100",
    );
  });

  test("налог посчитан по ставке или выключен — «Налог вручную» пустой", () => {
    assert.equal(
      vatManualInput({ amount: 1234.56, vatEnabled: true, vatRate: 6, vatAmount: 74.07 }),
      "",
    );
    assert.equal(
      vatManualInput({ amount: 1000, vatEnabled: false, vatRate: null, vatAmount: null }),
      "",
    );
    assert.equal(vatManualInput(null), "");
  });

  test("повторное сохранение: из полей формы получается тот же налог", () => {
    const saved = { amount: 1000, vatEnabled: true, vatRate: null, vatAmount: 60 };
    const again = computeContractVat({
      amount: saved.amount,
      vatEnabled: saved.vatEnabled,
      vatRate: vatRateInput(saved.vatRate) === "" ? null : Number(vatRateInput(saved.vatRate)),
      vatAmountManual: Number(vatManualInput(saved)),
    });
    assert.deepEqual(again, { vatAmount: 60, amountWithVat: 1060 });
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
