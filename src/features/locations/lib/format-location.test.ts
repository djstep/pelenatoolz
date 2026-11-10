import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareLocations,
  formatScenePlaces,
  hasOwnPlace,
  placeOf,
  formatLocationTitle,
  locationAsPair,
  locationObjectName,
  locationSubName,
} from "@/features/locations/lib/format-location";

const newSub = { name: "КУХНЯ", parent: { name: "ДОМ" } };
const object = { name: "ЗАГОРОДНЫЙ ДОМ", parent: null };

describe("подпись объекта и подобъекта", () => {
  test("подобъект — «ОБЪЕКТ.ПОДОБЪЕКТ», разделитель на выбор", () => {
    assert.equal(formatLocationTitle(newSub), "ДОМ.КУХНЯ");
    assert.equal(formatLocationTitle(newSub, ". "), "ДОМ. КУХНЯ");
    assert.equal(formatLocationTitle(newSub, " / "), "ДОМ / КУХНЯ");
  });

  test("объект без подобъекта — только название", () => {
    assert.equal(formatLocationTitle(object), "ЗАГОРОДНЫЙ ДОМ");
    assert.equal(locationSubName(object), null);
  });

  test("объект строки — родитель у подобъекта, своё название у объекта", () => {
    assert.equal(locationObjectName(newSub), "ДОМ");
    assert.equal(locationObjectName(object), "ЗАГОРОДНЫЙ ДОМ");
    assert.equal(locationSubName(newSub), "КУХНЯ");
  });
});

describe("порядок объектов в списках и пара для импорта", () => {
  const home = { id: "h", name: "ДОМ", parent: null, sortOrder: 0 };
  const kitchen = { id: "k", name: "КУХНЯ", parent: { id: "h", name: "ДОМ" }, sortOrder: 2 };
  const hall = { id: "c", name: "КОРИДОР", parent: { id: "h", name: "ДОМ" }, sortOrder: 1 };
  const yard = { id: "y", name: "ДВОР ДОМА", parent: null, sortOrder: 0 };
  const forest = { id: "f", name: "ОПУШКА ЛЕСА", parent: null, sortOrder: 0 };

  test("подобъекты сразу за своим объектом, по порядку, а не по алфавиту своих названий", () => {
    const sorted = [kitchen, forest, hall, yard, home].sort(compareLocations).map((l) => l.id);
    assert.deepEqual(sorted, ["y", "h", "c", "k", "f"]);
  });

  test("пара «объект + подобъект» для импорта", () => {
    assert.deepEqual(locationAsPair(kitchen), { id: "k", name: "ДОМ", sublocation: "КУХНЯ" });
    assert.deepEqual(locationAsPair(home), { id: "h", name: "ДОМ", sublocation: null });
  });
});

describe("два объекта с одним названием", () => {
  test("подобъекты каждого — сразу за своим объектом", () => {
    const a = { id: "a", name: "ДОМ", parent: null, sortOrder: 0 };
    const b = { id: "b", name: "ДОМ", parent: null, sortOrder: 0 };
    const a1 = { id: "a1", name: "КУХНЯ", parent: { id: "a", name: "ДОМ" }, sortOrder: 1 };
    const b1 = { id: "b1", name: "БАНЯ", parent: { id: "b", name: "ДОМ" }, sortOrder: 1 };
    const sorted = [b1, a1, b, a].sort(compareLocations).map((l) => l.id);
    assert.deepEqual(sorted, ["a", "a1", "b", "b1"]);
  });
});

describe("колонка «Объект / подобъекты»", () => {
  const home = { id: "h", name: "ДОМ", parent: null };
  const kids = { id: "k", name: "ДЕТСКАЯ", parent: { id: "h", name: "ДОМ" }, sortOrder: 1 };
  const hall = { id: "c", name: "КОРИДОР", parent: { id: "h", name: "ДОМ" }, sortOrder: 2 };
  const yard = { id: "y", name: "ДВОР ДОМА", parent: null };
  const forest = { id: "f", name: "ОПУШКА ЛЕСА", parent: null };

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

describe("действующее место (адрес подобъекта или объекта)", () => {
  const house = { address: "ул. Лесная, 1", latitude: 55, longitude: 37 };
  test("подобъект со своим адресом — своё место целиком", () => {
    const facade = { address: "Павильон 3", latitude: null, longitude: null, parent: house };
    assert.deepEqual(placeOf(facade), { own: true, address: "Павильон 3", latitude: null, longitude: null });
  });
  test("подобъект без адреса — место объекта (адрес и координаты)", () => {
    const kitchen = { address: "  ", latitude: 1, longitude: 2, parent: house };
    assert.deepEqual(placeOf(kitchen), { own: false, address: "ул. Лесная, 1", latitude: 55, longitude: 37 });
  });
  test("объект — всегда своё", () => {
    assert.deepEqual(placeOf({ ...house, parent: null }), { own: true, address: "ул. Лесная, 1", latitude: 55, longitude: 37 });
    assert.equal(hasOwnPlace({ address: null, parent: null }), true);
  });
});
