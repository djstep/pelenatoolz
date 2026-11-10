import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildPlanFact, planPercent } from "@/features/smeta/lib/plan-fact";
import { buildItemsSnapshot, snapshotStructureKey, type SnapshotSourceArticle } from "@/features/smeta/lib/items-snapshot";
import { addMoney, percentOf } from "@/features/smeta/lib/summary-money";

describe("сводная: деньги, резерв и агентские", () => {
  test("итог уровня — сумма округлённых итогов, без потерь", () => {
    assert.deepEqual(
      addMoney([
        { amount: "150000.00", tax: "9000.00", total: "159000.00" },
        { amount: "0.10", tax: "0.20", total: "0.30" },
      ]),
      { amount: "150000.10", tax: "9000.20", total: "159000.30" },
    );
    assert.deepEqual(addMoney([]), { amount: "0.00", tax: "0.00", total: "0.00" });
  });

  test("процент от суммы с налогом — до копеек, половина вверх", () => {
    assert.equal(percentOf("234000.00", "10"), "23400.00");
    assert.equal(percentOf("100.05", "50"), "50.03");
    assert.equal(percentOf("1000.00", "0"), "0.00");
    assert.equal(planPercent(234000, 5), 11700);
  });

  test("план/факт: резерв и агентские входят в план проекта, факта на них нет", () => {
    const report = buildPlanFact({
      departments: [{ id: "a", name: "Транспорт", codePrefix: "TR" }],
      versions: new Map([["a", { number: 1, approvedAt: "2026-11-10T00:00:00.000Z", lines: [{ itemId: "i", code: "TR-01.01.01", name: "Камерваген", total: 1000 }] }]]),
      items: new Map([["i", { code: "TR-01.01.01", name: "Камерваген", group: "Транспорт / Спецтранспорт", departmentId: "a", archived: false, inAnyVersion: true }]]),
      facts: new Map([["i", { accrued: 300, paid: 100 }]]),
      unassigned: { accrued: 0, paid: 0 },
      percents: { reserve: 10, agency: 5 },
    });
    assert.equal(report.departments[0].rows[0].group, "Транспорт / Спецтранспорт");
    assert.equal(report.reserve?.plan, 100);
    assert.equal(report.agency?.plan, 50);
    assert.equal(report.project.plan, 1150);
    assert.equal(report.project.accrued, 300);
  });

  test("без процентов (фильтр по цеху) — резерва и агентских нет", () => {
    const report = buildPlanFact({
      departments: [],
      versions: new Map(),
      items: new Map(),
      facts: new Map(),
      unassigned: null,
      percents: null,
    });
    assert.equal(report.reserve, null);
    assert.equal(report.agency, null);
  });
});

describe("пересчёт по переменным: строение сметы", () => {
  const vars = [{ id: "smeny", key: "SMENY", label: "СМЕНЫ", value: "10" }];
  const articles = (rate: string, name = "Транспорт"): SnapshotSourceArticle[] => [
    {
      id: "a1",
      templateArticleId: "t1",
      name,
      subarticles: [
        {
          id: "s1",
          name: "Спецтранспорт",
          items: [
            {
              id: "i1",
              code: "TR-01.01.01",
              name: "Камерваген",
              unit: "смена",
              quantity: "1",
              rate,
              taxPercent: "6",
              expenseType: null,
              paymentForm: "ИП",
              multiplier1VariableId: "smeny",
              multiplier1Value: null,
              multiplier2VariableId: null,
              multiplier2Value: null,
              multiplier3VariableId: null,
              multiplier3Value: null,
            },
          ],
        },
      ],
    },
  ];

  test("изменились только значения переменных — строение то же", () => {
    const before = buildItemsSnapshot(articles("15000"), vars);
    const after = buildItemsSnapshot(articles("15000"), [{ ...vars[0], value: "12" }]);
    assert.notEqual(before.totals.total, after.totals.total);
    assert.equal(snapshotStructureKey(before), snapshotStructureKey(after));
  });

  test("15000 и 15000.00 — одно и то же; переименование статьи в шаблоне не в счёт", () => {
    assert.equal(
      snapshotStructureKey(buildItemsSnapshot(articles("15000"), vars)),
      snapshotStructureKey(buildItemsSnapshot(articles("15000.00", "Транспорт и логистика"), vars)),
    );
  });

  test("глава поменял ставку — строение другое", () => {
    assert.notEqual(
      snapshotStructureKey(buildItemsSnapshot(articles("15000"), vars)),
      snapshotStructureKey(buildItemsSnapshot(articles("16000"), vars)),
    );
  });
});
