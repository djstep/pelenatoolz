import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  newRowFields,
  refreshedRowFields,
  splitWorkRows,
  timesAfterRefresh,
  transportCandidate,
  type SeedCandidate,
} from "@/features/reports/lib/work-row-sync-rules";

function transport(over: Partial<Parameters<typeof transportCandidate>[0]> = {}) {
  return {
    id: "t1",
    name: "Кран",
    callTime: "07:00",
    wrapTime: "19:00",
    kmRate: 50,
    budgetItemId: "b1",
    ...over,
  };
}

/** Строка отчёта, как в базе (нужные поля): км введены, статьи нет (старая строка). */
function reportRow(over: Record<string, unknown> = {}) {
  return {
    id: "row1",
    sourceKey: "transport:t1",
    displayName: "Кран",
    factStart: null as string | null,
    factEnd: null as string | null,
    factKm: 120,
    budgetItemId: null as string | null,
    ...over,
  };
}

describe("спецтранспорт в отчёте смены", () => {
  test("кандидат несёт статью строки и конец работы", () => {
    const c = transportCandidate(transport(), 3);
    assert.equal(c.sourceKey, "transport:t1");
    assert.equal(c.kind, "TRANSPORT");
    assert.equal(c.budgetItemId, "b1");
    assert.equal(c.factStart, "07:00");
    assert.equal(c.factEnd, "19:00");
    assert.equal(c.kmRate, 50);
    assert.equal(c.sortOrder, 3);
  });

  test("id спецтранспорта не менялся — строка отчёта та же, не в «removed», км остаются", () => {
    // После сохранения по id у строки тот же id — «Обновить из КПП» находит строку отчёта.
    const prev = reportRow();
    const c = transportCandidate(transport({ name: "Кран 25 м" }), 0);
    const split = splitWorkRows([c], [prev]);
    assert.deepEqual(split.added, []);
    assert.deepEqual(split.removed, []);
    assert.equal(split.kept.length, 1);
    assert.equal(split.kept[0]!.prev, prev);

    const fields = refreshedRowFields(prev, c);
    assert.equal(fields.displayName, "Кран 25 м");
    assert.equal("factKm" in fields, false, "факт км не перезаписывается");
    assert.equal({ ...prev, ...fields }.factKm, 120);
  });

  test("при пересоздании (новый id) старая строка ушла бы в «removed» — от этого и защищает сохранение по id", () => {
    const split = splitWorkRows([transportCandidate(transport({ id: "t-new" }), 0)], [reportRow()]);
    assert.deepEqual(split.removed.map((r) => r.id), ["row1"]);
    assert.deepEqual(split.added.map((c) => c.sourceKey), ["transport:t-new"]);
  });

  test("статья попадает в НОВУЮ строку отчёта", () => {
    const fields = newRowFields("rep1", transportCandidate(transport(), 2));
    assert.equal(fields.budgetItemId, "b1");
    assert.equal(fields.factStart, "07:00");
    assert.equal(fields.factEnd, "19:00");
    assert.equal(fields.reportId, "rep1");
    assert.equal(fields.sortOrder, 2);
  });

  test("у существующей строки отчёта статья не меняется (старая «без статьи» остаётся null)", () => {
    const prev = reportRow({ budgetItemId: null });
    const fields = refreshedRowFields(prev, transportCandidate(transport({ budgetItemId: "b2" }), 0));
    assert.equal("budgetItemId" in fields, false);
    assert.equal({ ...prev, ...fields }.budgetItemId, null);

    const withItem = reportRow({ budgetItemId: "b1" });
    const next = { ...withItem, ...refreshedRowFields(withItem, transportCandidate(transport({ budgetItemId: "b2" }), 0)) };
    assert.equal(next.budgetItemId, "b1");
  });

  test("статья — только у строк спецтранспорта", () => {
    const actor: SeedCandidate = {
      sourceKey: "actor:a1",
      kind: "ACTOR",
      displayName: "Иванов",
      categoryLabel: "Актёр",
      actorId: "a1",
      budgetItemId: "b1",
      sortOrder: 0,
    };
    assert.equal(newRowFields("rep1", actor).budgetItemId, null);
  });

  test("время конца — только в пустое; заполненное не трогается", () => {
    const c = transportCandidate(transport({ callTime: "07:00", wrapTime: "19:00" }), 0);
    assert.deepEqual(timesAfterRefresh({ factStart: null, factEnd: "" }, c), {
      factStart: "07:00",
      factEnd: "19:00",
    });
    assert.deepEqual(timesAfterRefresh({ factStart: "06:00", factEnd: "21:30" }, c), {
      factStart: "06:00",
      factEnd: "21:30",
    });
    const noEnd = transportCandidate(transport({ wrapTime: null }), 0);
    assert.equal(timesAfterRefresh({ factStart: null, factEnd: null }, noEnd).factEnd, null);
  });
});
