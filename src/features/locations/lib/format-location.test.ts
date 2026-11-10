import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareLocations,
  formatScenePlaces,
  formatLocationTitle,
  locationAsPair,
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

describe("порядок объектов в списках и пара для импорта", () => {
  const home = { id: "h", name: "ДОМ", sublocation: null, parent: null, sortOrder: 0 };
  const kitchen = { id: "k", name: "КУХНЯ", sublocation: null, parent: { id: "h", name: "ДОМ" }, sortOrder: 2 };
  const hall = { id: "c", name: "КОРИДОР", sublocation: null, parent: { id: "h", name: "ДОМ" }, sortOrder: 1 };
  const yard = { id: "y", name: "ДВОР ДОМА", sublocation: null, parent: null, sortOrder: 0 };
  const forest = { id: "f", name: "ОПУШКА ЛЕСА", sublocation: null, parent: null, sortOrder: 0 };

  test("подобъекты сразу за своим объектом, по порядку, а не по алфавиту своих названий", () => {
    const sorted = [kitchen, forest, hall, yard, home].sort(compareLocations).map((l) => l.id);
    assert.deepEqual(sorted, ["y", "h", "c", "k", "f"]);
  });

  test("пара «объект + подобъект» одинакова для старой и новой записи", () => {
    assert.deepEqual(locationAsPair(kitchen), { id: "k", name: "ДОМ", sublocation: "КУХНЯ" });
    assert.deepEqual(locationAsPair({ id: "o", name: "ДОМ", sublocation: "КУХНЯ", parent: null }), {
      id: "o",
      name: "ДОМ",
      sublocation: "КУХНЯ",
    });
    assert.deepEqual(locationAsPair(home), { id: "h", name: "ДОМ", sublocation: null });
  });
});

describe("два объекта с одним названием", () => {
  test("подобъекты каждого — сразу за своим объектом", () => {
    const a = { id: "a", name: "ДОМ", sublocation: null, parent: null, sortOrder: 0 };
    const b = { id: "b", name: "ДОМ", sublocation: null, parent: null, sortOrder: 0 };
    const a1 = { id: "a1", name: "КУХНЯ", sublocation: null, parent: { id: "a", name: "ДОМ" }, sortOrder: 1 };
    const b1 = { id: "b1", name: "БАНЯ", sublocation: null, parent: { id: "b", name: "ДОМ" }, sortOrder: 1 };
    const sorted = [b1, a1, b, a].sort(compareLocations).map((l) => l.id);
    assert.deepEqual(sorted, ["a", "a1", "b", "b1"]);
  });
});

describe("колонка «Объект / подобъекты»", () => {
  const home = { id: "h", name: "ДОМ", sublocation: null, parent: null };
  const kids = { id: "k", name: "ДЕТСКАЯ", sublocation: null, parent: { id: "h", name: "ДОМ" }, sortOrder: 1 };
  const hall = { id: "c", name: "КОРИДОР", sublocation: null, parent: { id: "h", name: "ДОМ" }, sortOrder: 2 };
  const yard = { id: "y", name: "ДВОР ДОМА", sublocation: null, parent: null };
  const forest = { id: "f", name: "ОПУШКА ЛЕСА", sublocation: null, parent: null };

  test("смежные подобъекты — при своём объекте, по порядку", () => {
    assert.equal(formatScenePlaces([hall, kids]), "ДОМ · ДЕТСКАЯ / КОРИДОР");
  });

  test("два объекта без подобъектов", () => {
    assert.equal(formatScenePlaces([yard, forest]), "ДВОР ДОМА / ОПУШКА ЛЕСА");
  });

  test("объект целиком и объект с подобъектом", () => {
    assert.equal(formatScenePlaces([home]), "ДОМ");
    assert.equal(formatScenePlaces([kids, yard]), "ДВОР ДОМА; ДОМ · ДЕТСКАЯ");
  });

  test("мест нет — прочерк", () => {
    assert.equal(formatScenePlaces([]), "—");
  });
});
