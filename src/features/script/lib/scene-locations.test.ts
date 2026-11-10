import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cardPlaces, sceneLocationIdsAfterCard } from "@/features/script/lib/scene-locations";

// ДОМ (home) → ДЕТСКАЯ (kids), КОРИДОР (hall), КУХНЯ (kitchen); ДВОР ДОМА (yard), ОПУШКА ЛЕСА (forest).
const kids = { locationId: "kids", objectId: "home" };
const hall = { locationId: "hall", objectId: "home" };
const yard = { locationId: "yard", objectId: "yard" };
const forest = { locationId: "forest", objectId: "forest" };

describe("карточка сцены: что показывает", () => {
  test("смежная сцена — объект ДОМ и оба подобъекта", () => {
    assert.deepEqual(cardPlaces([kids, hall]), { objectId: "home", subIds: ["kids", "hall"], otherObjectIds: [] });
  });

  test("два объекта — первый в полях, второй пометкой", () => {
    assert.deepEqual(cardPlaces([yard, forest]), { objectId: "yard", subIds: [], otherObjectIds: ["forest"] });
  });

  test("привязок нет — пусто", () => {
    assert.deepEqual(cardPlaces([]), { objectId: "", subIds: [], otherObjectIds: [] });
  });
});

describe("карточка сцены: привязки после сохранения", () => {
  test("«ДЕТСКАЯ / КОРИДОР» без изменений — обе привязки на месте", () => {
    const ids = sceneLocationIdsAfterCard({ current: [kids, hall], prevObjectId: "home", objectId: "home", subIds: ["kids", "hall"] });
    assert.deepEqual(ids, ["kids", "hall"]);
  });

  test("добавили КУХНЮ, убрали КОРИДОР", () => {
    const ids = sceneLocationIdsAfterCard({ current: [kids, hall], prevObjectId: "home", objectId: "home", subIds: ["kids", "kitchen"] });
    assert.deepEqual(ids, ["kids", "kitchen"]);
  });

  test("подобъекты сняли — сцена привязана к объекту целиком", () => {
    const ids = sceneLocationIdsAfterCard({ current: [kids, hall], prevObjectId: "home", objectId: "home", subIds: [] });
    assert.deepEqual(ids, ["home"]);
  });

  test("два объекта: правим первый — второй (ОПУШКА ЛЕСА) остаётся", () => {
    const ids = sceneLocationIdsAfterCard({ current: [yard, forest], prevObjectId: "yard", objectId: "yard", subIds: [] });
    assert.deepEqual(ids, ["yard", "forest"]);
  });

  test("сменили объект — привязки прежнего заменяются, другие объекты остаются", () => {
    const ids = sceneLocationIdsAfterCard({ current: [yard, forest], prevObjectId: "yard", objectId: "home", subIds: ["hall"] });
    assert.deepEqual(ids, ["hall", "forest"]);
  });

  test("старая форма без prevObjectId — показанным считается объект первой привязки", () => {
    const ids = sceneLocationIdsAfterCard({ current: [kids, hall], prevObjectId: null, objectId: "home", subIds: ["kids"] });
    assert.deepEqual(ids, ["kids"]);
  });

  test("новая сцена — только выбор", () => {
    assert.deepEqual(sceneLocationIdsAfterCard({ current: [], prevObjectId: null, objectId: "home", subIds: [] }), ["home"]);
  });
});
