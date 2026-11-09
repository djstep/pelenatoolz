import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { diffBudget } from "@/features/smeta/lib/budget-diff";
import {
  buildItemsSnapshot,
  changedVariables,
  parseItemsSnapshot,
  snapshotDiffSources,
  snapshotMultipliersText,
  snapshotVariableIds,
  type SnapshotSourceArticle,
  type SnapshotVariable,
} from "@/features/smeta/lib/items-snapshot";

const vars: SnapshotVariable[] = [
  { id: "smeny", key: "SMENY", label: "СМЕНЫ", value: "10" },
  { id: "nedeli", key: "NEDELI", label: "НЕДЕЛИ", value: null },
];

function item(id: string, over: Partial<SnapshotSourceArticle["subarticles"][number]["items"][number]> = {}) {
  return {
    id,
    code: `TR-01.01.0${id.length}`,
    name: `Строка ${id}`,
    unit: "смена",
    quantity: "1",
    rate: "15000",
    taxPercent: "6",
    expenseType: "Транспорт",
    paymentForm: "ИП",
    multiplier1VariableId: "smeny",
    multiplier1Value: null,
    multiplier2VariableId: null,
    multiplier2Value: null,
    multiplier3VariableId: null,
    multiplier3Value: null,
    ...over,
  };
}

const articles: SnapshotSourceArticle[] = [
  {
    id: "a1",
    templateArticleId: "t1",
    name: "Транспорт",
    subarticles: [
      {
        id: "s1",
        name: "Спецтранспорт",
        items: [
          item("cam"),
          item("grim", { rate: "10000", multiplier1VariableId: "nedeli" }),
          item("disc", { rate: "1000", multiplier1VariableId: null, multiplier1Value: "0.7", taxPercent: null }),
        ],
      },
    ],
  },
];

describe("снимок сметы по статьям для версии", () => {
  test("расчёт и итоги как на экране; строка без суммы — отдельно", () => {
    const s = buildItemsSnapshot(articles, vars);
    const [cam, grim, disc] = s.articles[0].subarticles[0].lines;
    assert.equal(cam.total, "159000.00");
    assert.equal(grim.total, null);
    assert.deepEqual(grim.problems, [{ kind: "variable_missing", variableId: "nedeli" }]);
    assert.equal(disc.total, "700.00");
    assert.equal(s.totals.total, "159700.00");
    assert.equal(s.totals.incomplete, 1);
    assert.equal(s.lineCount, 3);
    assert.equal(s.articles[0].totals.total, "159700.00");
  });

  test("множители — со значениями на момент снимка", () => {
    const s = buildItemsSnapshot(articles, vars);
    const lines = s.articles[0].subarticles[0].lines;
    assert.equal(snapshotMultipliersText(lines[0].multipliers), "× СМЕНЫ (10)");
    assert.equal(snapshotMultipliersText(lines[1].multipliers), "× НЕДЕЛИ (не задана)");
    assert.equal(snapshotMultipliersText(lines[2].multipliers), "× 0,7");
    assert.deepEqual([...snapshotVariableIds(s)].sort(), ["nedeli", "smeny"]);
  });

  test("для сравнения: место строки словами, код только во внутреннем поле", () => {
    const sources = snapshotDiffSources(buildItemsSnapshot(articles, vars));
    assert.equal(sources[0].group, "Транспорт / Спецтранспорт");
    assert.equal(sources[0].multipliers, "× СМЕНЫ (10)");
    assert.equal(sources[1].total, 0);
    assert.ok(!sources[0].group?.includes("TR-"));
  });

  test("смена переменной: сравнение показывает изменённые суммы и множитель", () => {
    const before = snapshotDiffSources(buildItemsSnapshot(articles, vars));
    const after = snapshotDiffSources(
      buildItemsSnapshot(articles, [{ ...vars[0], value: "12" }, vars[1]]),
    );
    const diff = diffBudget(before, after);
    assert.equal(diff.counts.changed, 1);
    const row = diff.rows.find((r) => r.kind === "changed")!;
    assert.deepEqual(row.fields.sort(), ["amount", "multipliers", "tax", "total"].sort());
  });

  test("пометка «изменилась после утверждения»: только используемые и только изменившиеся", () => {
    const approved = [...vars, { id: "serii", key: "SERII", label: "СЕРИИ", value: "8" }];
    const current = [
      { ...vars[0], value: "12" },
      { ...vars[1], value: null },
      { id: "serii", key: "SERII", label: "СЕРИИ", value: "9" },
    ];
    assert.deepEqual(changedVariables(approved, current, new Set(["smeny", "nedeli"])), [
      { label: "СМЕНЫ", before: "10", after: "12" },
    ]);
    // 10 и 10.0000 — одно и то же значение.
    assert.deepEqual(changedVariables(approved, [{ ...vars[0], value: "10.0000" }], new Set(["smeny"])), []);
  });

  test("снимок из базы: свой формат читается, чужое — null", () => {
    const s = buildItemsSnapshot(articles, vars);
    assert.deepEqual(parseItemsSnapshot(JSON.parse(JSON.stringify(s))), s);
    assert.equal(parseItemsSnapshot({ version: 2 }), null);
    assert.equal(parseItemsSnapshot(null), null);
  });
});
