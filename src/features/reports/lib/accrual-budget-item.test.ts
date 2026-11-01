import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AccrualReportPart } from "@prisma/client";
import {
  budgetItemFor,
  budgetItemOnCreate,
  budgetItemOnUpdate,
  type AccrualBudgetRow,
} from "@/features/reports/lib/accrual-budget-item";

function transportRow(budgetItemId: string | null): AccrualBudgetRow {
  return { kind: "TRANSPORT", budgetItemId, actor: null, item: null, location: null };
}

const resourceRow: AccrualBudgetRow = {
  kind: "RESOURCE",
  budgetItemId: null,
  actor: null,
  item: {
    defaultBudgetItemId: "main",
    overtimeBudgetItemId: "ot",
    mileageBudgetItemId: "km",
  },
  location: null,
};

describe("статья начислений спецтранспорта", () => {
  test("новое начисление получает статью строки отчёта", () => {
    assert.equal(budgetItemOnCreate(transportRow("b1"), AccrualReportPart.MILEAGE), "b1");
    assert.equal(budgetItemOnCreate(transportRow("b1"), AccrualReportPart.EXTRAS), "b1");
    assert.equal(budgetItemOnCreate(transportRow(null), AccrualReportPart.MILEAGE), null);
  });

  test("у существующего начисления статья не меняется; старое «без статьи» остаётся null", () => {
    for (const editedManually of [false, true]) {
      assert.equal(
        budgetItemOnUpdate(
          { budgetItemId: null, editedManually },
          transportRow("b1"),
          AccrualReportPart.MILEAGE,
        ),
        undefined,
      );
      assert.equal(
        budgetItemOnUpdate(
          { budgetItemId: "b1", editedManually },
          transportRow("b2"),
          AccrualReportPart.MILEAGE,
        ),
        undefined,
      );
    }
  });
});

describe("остальные строки — как раньше", () => {
  test("статья с карточки по части оплаты", () => {
    assert.equal(budgetItemFor(resourceRow, AccrualReportPart.SHIFT), "main");
    assert.equal(budgetItemFor(resourceRow, AccrualReportPart.OVERTIME), "ot");
    assert.equal(budgetItemFor(resourceRow, AccrualReportPart.MILEAGE), "km");
    assert.equal(budgetItemOnCreate(resourceRow, AccrualReportPart.SHIFT), "main");
  });

  test("пересчёт меняет статью, если не правили руками", () => {
    assert.equal(
      budgetItemOnUpdate({ budgetItemId: null, editedManually: false }, resourceRow, AccrualReportPart.SHIFT),
      "main",
    );
    assert.equal(
      budgetItemOnUpdate({ budgetItemId: "main", editedManually: false }, resourceRow, AccrualReportPart.SHIFT),
      undefined,
    );
    assert.equal(
      budgetItemOnUpdate({ budgetItemId: "x", editedManually: true }, resourceRow, AccrualReportPart.SHIFT),
      undefined,
    );
  });
});
