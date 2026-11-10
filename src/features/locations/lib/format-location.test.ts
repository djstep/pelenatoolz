import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatLocationTitle,
  locationObjectName,
  locationSubName,
} from "@/features/locations/lib/format-location";

const oldSub = { name: "ДОМ", sublocation: "КУХНЯ", parent: null };
const newSub = { name: "КУХНЯ", sublocation: null, parent: { name: "ДОМ" } };
const object = { name: "ЗАГОРОДНЫЙ ДОМ", sublocation: null, parent: null };

describe("подпись объекта и подобъекта", () => {
  test("старая запись (подобъект в sublocation) и новая (с родителем) — одна подпись", () => {
    assert.equal(formatLocationTitle(oldSub), "ДОМ.КУХНЯ");
    assert.equal(formatLocationTitle(newSub), "ДОМ.КУХНЯ");
    assert.equal(formatLocationTitle(newSub, ". "), "ДОМ. КУХНЯ");
    assert.equal(formatLocationTitle(newSub, " / "), "ДОМ / КУХНЯ");
  });

  test("объект без подобъекта — только название", () => {
    assert.equal(formatLocationTitle(object), "ЗАГОРОДНЫЙ ДОМ");
    assert.equal(locationSubName(object), null);
    assert.equal(formatLocationTitle({ name: "ДОМ", sublocation: "  ", parent: null }), "ДОМ");
  });

  test("объект строки — родитель у подобъекта, своё название у объекта", () => {
    assert.equal(locationObjectName(oldSub), "ДОМ");
    assert.equal(locationObjectName(newSub), "ДОМ");
    assert.equal(locationObjectName(object), "ЗАГОРОДНЫЙ ДОМ");
    assert.equal(locationSubName(oldSub), "КУХНЯ");
    assert.equal(locationSubName(newSub), "КУХНЯ");
  });
});
