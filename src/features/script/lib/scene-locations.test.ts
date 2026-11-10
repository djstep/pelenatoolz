import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { keptSceneLocationIds } from "@/features/script/lib/scene-locations";

describe("карточка сцены: привязки к объектам при сохранении", () => {
  test("смежная сцена «ДЕТСКАЯ / КОРИДОР»: объект не меняли — обе привязки на месте", () => {
    assert.deepEqual(keptSceneLocationIds(["kids", "hall"], "kids"), ["kids", "hall"]);
  });

  test("выбрали вторую из привязанных — ничего не теряется", () => {
    assert.deepEqual(keptSceneLocationIds(["kids", "hall"], "hall"), ["kids", "hall"]);
  });

  test("выбрали другой объект — он вместо первой привязки, остальные остаются", () => {
    assert.deepEqual(keptSceneLocationIds(["kids", "hall"], "kitchen"), ["kitchen", "hall"]);
  });

  test("привязок не было — одна выбранная", () => {
    assert.deepEqual(keptSceneLocationIds([], "kids"), ["kids"]);
  });
});
