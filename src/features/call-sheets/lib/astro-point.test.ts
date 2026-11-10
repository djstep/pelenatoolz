import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pickAstroPoint } from "@/features/call-sheets/lib/astro-point";

const noCoords = { name: "Квартира", sublocation: null, parent: null, latitude: null, longitude: null };
const park = { name: "Парк", sublocation: "Аллея", parent: null, latitude: 59.94, longitude: 30.31 };
const field = { name: "Поле", sublocation: null, parent: null, latitude: 55.75, longitude: 37.62 };

describe("восход и закат — где считать", () => {
  test("объект схемы с координатами — по нему", () => {
    assert.deepEqual(pickAstroPoint(field, [park]), {
      latitude: 55.75,
      longitude: 37.62,
      label: "Поле",
    });
  });

  test("у объекта схемы нет координат — первый объект дня с координатами", () => {
    assert.deepEqual(pickAstroPoint(noCoords, [noCoords, park, field]), {
      latitude: 59.94,
      longitude: 30.31,
      label: "Парк. Аллея",
    });
  });

  test("координат нигде нет — null (по городу проекта)", () => {
    assert.equal(pickAstroPoint(null, [noCoords]), null);
    assert.equal(pickAstroPoint(undefined, []), null);
  });

  test("нулевые координаты — тоже координаты", () => {
    assert.ok(pickAstroPoint({ name: "Гвинейский залив", sublocation: null, parent: null, latitude: 0, longitude: 0 }, []));
  });
});

describe("восход и закат — подобъект", () => {
  test("подобъект с родителем — подпись «Объект. Подобъект»", () => {
    const kitchen = { name: "Кухня", sublocation: null, parent: { name: "Дом" }, latitude: 1, longitude: 2 };
    assert.equal(pickAstroPoint(kitchen, [])?.label, "Дом. Кухня");
  });
});
