import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import {
  RATE_CHANGE_FIELDS,
  workRowAccess,
  workRowsForViewer,
  type ReportViewer,
} from "@/features/reports/lib/report-access";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  canEntityFinance,
  type CategoryFinancePermissions,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";
import { pickFinanceFields } from "@/shared/lib/finance-fields";

function viewer(
  matrix: PermissionMatrix,
  categoryFinance: Record<string, CategoryFinancePermissions> = {},
): ReportViewer {
  return {
    can: (p) => hasPermission(matrix, p),
    canFinanceRead: (t) => canEntityFinance(matrix, categoryFinance, t, "read"),
    canFinanceWrite: (t) => canEntityFinance(matrix, categoryFinance, t, "write"),
  };
}

const view = { access: true, read: true };

/** Как роль «ТЕСТ без финансов»: просмотр разделов, ни одного фин. флажка. */
function noFinance(): PermissionMatrix {
  const m = buildEmptyMatrix();
  for (const s of ["scenes", "schedule", "actors", "characters", "locations", "elements", "reports"] as const) {
    m[s] = { ...m[s], ...view };
  }
  return m;
}

function actorsFinanceOnly(): PermissionMatrix {
  const m = noFinance();
  m.actors = { ...m.actors, financeRead: true, financeWrite: true };
  return m;
}

const baseRow = {
  id: "r1",
  reportId: "rep1",
  displayName: "Иванов · Герой",
  factStart: "08:00",
  factEnd: "21:00",
  workedMin: 780,
  factOvertimeMin: 60,
  payableOvertimeMin: 60,
  shiftHoursMin: 720,
  factKm: 12,
  shiftRate: 15000,
  taxPercent: 13,
  shiftPay: 16950,
  overtimePay: 2000,
  extrasPay: 500,
  kmRate: 40,
  mileagePay: 480,
  totalPay: 19930,
  overtimeRates: [{ hourNumber: 1, amount: 2000 }],
  extras: [{ id: "e1", amount: 500 }],
  item: null as { categoryId: string } | null,
};

const MONEY = [
  "shiftRate",
  "taxPercent",
  "shiftPay",
  "overtimePay",
  "extrasPay",
  "kmRate",
  "mileagePay",
  "totalPay",
  "extras",
  "overtimeRates",
];

describe("отчёт смены: строки работы", () => {
  test("без фин. прав денег нет, часы и переработка остаются", () => {
    const [row] = workRowsForViewer([{ ...baseRow, kind: "ACTOR" as const }], viewer(noFinance()));
    for (const key of MONEY) assert.equal(key in row, false, key);
    assert.equal(row.workedMin, 780);
    assert.equal(row.payableOvertimeMin, 60);
    assert.equal(row.shiftHoursMin, 720);
    assert.equal(row.factKm, 12);
    assert.equal(row.canSeePay, false);
    assert.equal(row.canEditPay, false);
    assert.equal("item" in row, false);
  });

  test("продюсер видит деньги (почасовые ставки строки в браузер не нужны никому)", () => {
    const [row] = workRowsForViewer([{ ...baseRow, kind: "ACTOR" as const }], viewer(buildFullMatrix()));
    assert.equal(row.totalPay, 19930);
    assert.equal(row.extras?.length, 1);
    assert.equal(row.canEditPay, true);
    assert.equal("overtimeRates" in row, false);
  });

  test("право по источнику: с фин. правами актёров деньги актёра есть, объекта — нет", () => {
    const v = viewer(actorsFinanceOnly());
    const rows = workRowsForViewer(
      [
        { ...baseRow, id: "a", kind: "ACTOR" as const },
        { ...baseRow, id: "l", kind: "LOCATION" as const },
      ],
      v,
    );
    assert.equal(rows.find((r) => r.id === "a")?.totalPay, 19930);
    assert.equal("totalPay" in rows.find((r) => r.id === "l")!, false);
  });

  test("ресурс — по фин. праву его категории", () => {
    const v = viewer(noFinance(), { cat1: { financeRead: true, financeWrite: false } });
    const rows = workRowsForViewer(
      [
        { ...baseRow, id: "x", kind: "RESOURCE" as const, item: { categoryId: "cat1" } },
        { ...baseRow, id: "y", kind: "RESOURCE" as const, item: { categoryId: "cat2" } },
      ],
      v,
    );
    const x = rows.find((r) => r.id === "x")!;
    assert.equal(x.totalPay, 19930);
    assert.equal(x.canEditPay, false);
    assert.equal("totalPay" in rows.find((r) => r.id === "y")!, false);
  });

  test("спецтранспорт — по finance:read", () => {
    assert.equal(workRowAccess(viewer(actorsFinanceOnly()), { kind: "TRANSPORT", categoryId: null }).financeRead, false);
    assert.equal(workRowAccess(viewer(buildFullMatrix()), { kind: "TRANSPORT", categoryId: null }).financeRead, true);
  });

  test("строка без права источника и без finance:read не уходит", () => {
    const m = noFinance();
    m.actors = { ...m.actors, access: false, read: false };
    assert.deepEqual(workRowsForViewer([{ ...baseRow, kind: "ACTOR" as const }], viewer(m)), []);
  });
});

describe("отчёт смены: «было → стало»", () => {
  const change = {
    rowId: "r1",
    name: "Иванов",
    fields: [{ label: "Ставка смены", before: "10 000", after: "15 000" }],
    pay: { before: "11 300", after: "16 950" },
  };

  test("без фин. просмотра — только факт расхождения, без значений", () => {
    assert.deepEqual(pickFinanceFields(change, RATE_CHANGE_FIELDS, false), {
      rowId: "r1",
      name: "Иванов",
    });
  });

  test("с фин. просмотром значения есть", () => {
    assert.deepEqual(pickFinanceFields(change, RATE_CHANGE_FIELDS, true), change);
  });
});
