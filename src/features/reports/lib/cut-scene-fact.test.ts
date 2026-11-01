import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cutSceneFactRefusal } from "./cut-scene-fact";

describe("факт по вырезанной сцене", () => {
  const refusal = "Сцена 2 вырезана — верните её в либретто, чтобы записать факт";

  test("вырезанная не в дне — отказ (новая строка и правка уже сохранённой строки факта)", () => {
    assert.equal(cutSceneFactRefusal({ cut: true, inDay: false, label: "2" }), refusal);
  });

  test("вырезанная в дне — факт пишется как есть", () => {
    assert.equal(cutSceneFactRefusal({ cut: true, inDay: true, label: "2" }), null);
  });

  test("невырезанная — как раньше, в том числе не в дне", () => {
    assert.equal(cutSceneFactRefusal({ cut: false, inDay: false, label: "2" }), null);
    assert.equal(cutSceneFactRefusal({ cut: false, inDay: true, label: "2" }), null);
  });
});
