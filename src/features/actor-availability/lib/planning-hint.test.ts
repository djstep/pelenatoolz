import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeDaySceneHints,
  planningHintWords,
} from "@/features/actor-availability/lib/planning-hint";

const DATE = new Date("2026-11-13T00:00:00.000Z");
const KEY = "2026-11-13";

/** Сцена в дне: id записи и персонажи. */
const row = (id: string, ...characters: string[]) => ({
  id,
  scene: { characters: characters.map((c) => ({ character: { id: c } })) },
});

const characterToActor = { ivan: "a-ivan", maria: "a-maria" };
const rowIdByActor = new Map([
  ["a-ivan", "row-ivan"],
  ["a-maria", "row-maria"],
]);

function hint(
  days: Parameters<typeof computeDaySceneHints>[0],
  manual: Parameters<typeof computeDaySceneHints>[2],
  rowId: string,
) {
  return computeDaySceneHints(days, characterToActor, manual, rowIdByActor).get(rowId);
}

describe("computeDaySceneHints — занятость на карточках сцен в днях", () => {
  test("своя сцена в дне — не занятость: актёр свободен", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan")] }];
    assert.equal(hint(days, {}, "r1"), "all_free");
  });

  test("две сцены одного дня с одним актёром — свободен", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan"), row("r2", "ivan")] }];
    assert.equal(hint(days, {}, "r2"), "all_free");
  });

  test("в календаре занят в другом проекте — заняты", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan")] }];
    const manual = { "row-ivan": { [KEY]: { status: "BUSY_OTHER", comment: null } } };
    assert.equal(hint(days, manual, "r1"), "none_free");
  });

  test("недоступен в календаре — заняты", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan")] }];
    const manual = { "row-ivan": { [KEY]: { status: "UNAVAILABLE", comment: null } } };
    assert.equal(hint(days, manual, "r1"), "none_free");
  });

  test("один актёр занят, другой свободен — частично", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan", "maria")] }];
    const manual = { "row-maria": { [KEY]: { status: "BUSY_OTHER", comment: null } } };
    assert.equal(hint(days, manual, "r1"), "partial");
  });

  test("«занят (наш проект)» в календаре — это запись самого КПП, не занятость", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan")] }];
    const manual = { "row-ivan": { [KEY]: { status: "BUSY_OUR_PROJECT", comment: "примерка" } } };
    assert.equal(hint(days, manual, "r1"), "all_free");
  });

  test("актёр в другом съёмочном дне на ту же дату — заняты", () => {
    const days = [
      { id: "d1", date: DATE, scenes: [row("r1", "ivan")] },
      { id: "d2", date: DATE, scenes: [row("r2", "ivan")] },
    ];
    assert.equal(hint(days, {}, "r1"), "none_free");
    assert.equal(hint(days, {}, "r2"), "none_free");
  });

  test("другой день на другую дату не мешает", () => {
    const days = [
      { id: "d1", date: DATE, scenes: [row("r1", "ivan")] },
      { id: "d2", date: new Date("2026-11-14T00:00:00.000Z"), scenes: [row("r2", "ivan")] },
    ];
    assert.equal(hint(days, {}, "r1"), "all_free");
  });

  test("занятость другой даты не влияет", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan")] }];
    const manual = { "row-ivan": { "2026-11-20": { status: "BUSY_OTHER", comment: null } } };
    assert.equal(hint(days, manual, "r1"), "all_free");
  });

  test("у персонажей сцены нет актёров — без слова", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "unknown")] }];
    const result = hint(days, {}, "r1");
    assert.equal(result, "neutral");
    assert.equal(planningHintWords[result!], undefined);
  });

  test("актёра нет в календаре — как у кольца: свободны", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan")] }];
    const hints = computeDaySceneHints(days, characterToActor, {}, new Map());
    assert.equal(hints.get("r1"), "all_free");
  });

  test("одна запись на сцену, слова подписаны", () => {
    const days = [{ id: "d1", date: DATE, scenes: [row("r1", "ivan"), row("r2", "maria")] }];
    const hints = computeDaySceneHints(days, characterToActor, {}, rowIdByActor);
    assert.equal(hints.size, 2);
    assert.deepEqual(planningHintWords, {
      all_free: "свободны",
      partial: "частично",
      none_free: "заняты",
    });
  });
});
