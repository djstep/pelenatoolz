import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COORDINATES_FORMAT_ERROR } from "@/features/locations/lib/coordinates";
import {
  canEditLocationScheme,
  checkLocationSchemeSave,
  LOCATION_NOT_FOUND,
  locationSchemeChanges,
  MAX_SCHEME_POINTS,
  NO_RIGHTS,
  parseLocationScheme,
  type LocationInProjectCheck,
  type LocationSchemeData,
  type LocationSchemeInput,
} from "@/features/locations/lib/scheme-rules";

function point(over: Record<string, unknown> = {}) {
  return { number: "1", name: "База", description: "", ...over };
}

function form(over: Partial<LocationSchemeInput> = {}): LocationSchemeInput {
  return {
    coordinates: "59.938, 30.314",
    directions: "",
    parking: "",
    onSiteNotes: "",
    points: "[]",
    ...over,
  };
}

/** Проверка проекта: «свои» объекты перечислены, остальное — чужое. Запоминает вызовы. */
function fakeInProject(own: string[]) {
  const calls: string[] = [];
  const check: LocationInProjectCheck = async (id) => {
    calls.push(id);
    return own.includes(id);
  };
  return { check, calls };
}

function errorOf(result: { error: string } | { data: unknown }) {
  return "error" in result ? result.error : null;
}

describe("права на схему объекта", () => {
  test("правка — только с «Сценарий: правка», как у карточки объекта", () => {
    const access = (granted: string[]) => ({ can: (p: string) => granted.includes(p) });
    assert.equal(canEditLocationScheme(access(["script:read"])), false);
    assert.equal(canEditLocationScheme(access(["script:write"])), true);
  });

  test("без права — отказ, база не трогается", async () => {
    const { check, calls } = fakeInProject(["loc1"]);
    const result = await checkLocationSchemeSave({ canEdit: false, inProject: check }, "loc1", form());
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.equal(calls.length, 0);
  });
});

describe("чужой объект", () => {
  test("объект другого проекта — отказ", async () => {
    const { check, calls } = fakeInProject(["loc1"]);
    const result = await checkLocationSchemeSave({ canEdit: true, inProject: check }, "foreign", form());
    assert.deepEqual(result, { error: LOCATION_NOT_FOUND });
    assert.deepEqual(calls, ["foreign"]);
  });

  test("пустой или не строковый id — отказ без обращения к базе", async () => {
    const { check, calls } = fakeInProject([]);
    for (const id of ["", "  ", null, 42, "x".repeat(101)]) {
      const result = await checkLocationSchemeSave({ canEdit: true, inProject: check }, id, form());
      assert.deepEqual(result, { error: LOCATION_NOT_FOUND });
    }
    assert.equal(calls.length, 0);
  });

  test("свой объект — данные разобраны", async () => {
    const { check } = fakeInProject(["loc1"]);
    const result = await checkLocationSchemeSave(
      { canEdit: true, inProject: check },
      "loc1",
      form({
        directions: "  От метро 5 минут  ",
        points: JSON.stringify([point(), point({ number: "2", name: "Грим", description: " 2 этаж " })]),
      }),
    );
    assert.deepEqual(result, {
      locationId: "loc1",
      data: {
        latitude: 59.938,
        longitude: 30.314,
        directions: "От метро 5 минут",
        parking: null,
        onSiteNotes: null,
        points: [
          { number: "1", name: "База", description: null },
          { number: "2", name: "Грим", description: "2 этаж" },
        ],
      },
    });
  });
});

describe("ошибки в данных схемы", () => {
  test("пустые координаты и тексты — пусто в базе", () => {
    const result = parseLocationScheme(form({ coordinates: " ", directions: null, parking: undefined }));
    assert.deepEqual(result, {
      data: {
        latitude: null,
        longitude: null,
        directions: null,
        parking: null,
        onSiteNotes: null,
        points: [],
      },
    });
  });

  test("неверные координаты — ошибка разбора, проверка проекта не нужна", async () => {
    const { check, calls } = fakeInProject(["loc1"]);
    const result = await checkLocationSchemeSave(
      { canEdit: true, inProject: check },
      "loc1",
      form({ coordinates: "Москва" }),
    );
    assert.deepEqual(result, { error: COORDINATES_FORMAT_ERROR });
    assert.equal(calls.length, 0);
  });

  test("длинные тексты — отказ", () => {
    const long = "а".repeat(2001);
    assert.equal(errorOf(parseLocationScheme(form({ directions: long }))), "«Как добраться» — до 2000 символов");
    assert.equal(errorOf(parseLocationScheme(form({ parking: long }))), "«Парковка» — до 2000 символов");
    assert.equal(errorOf(parseLocationScheme(form({ onSiteNotes: long }))), "«На месте» — до 2000 символов");
    assert.equal(errorOf(parseLocationScheme(form({ directions: "а".repeat(2000) }))), null);
  });

  test("точки: номер и название обязательны, длины ограничены", () => {
    const withPoint = (over: Record<string, unknown>) =>
      errorOf(parseLocationScheme(form({ points: JSON.stringify([point(over)]) })));
    assert.equal(withPoint({ number: "  " }), "Укажите номер точки");
    assert.equal(withPoint({ name: "" }), "Укажите название точки");
    assert.equal(withPoint({ number: "1".repeat(21) }), "Номер точки — до 20 символов");
    assert.equal(withPoint({ name: "я".repeat(201) }), "Название точки — до 200 символов");
    assert.equal(withPoint({ description: "я".repeat(1001) }), "Описание точки — до 1000 символов");
    assert.equal(withPoint({ number: "1".repeat(20), name: "я".repeat(200), description: "я".repeat(1000) }), null);
  });

  test("точек не больше 100", () => {
    const many = (n: number) =>
      JSON.stringify(Array.from({ length: n }, (_, i) => point({ number: String(i + 1) })));
    assert.equal(errorOf(parseLocationScheme(form({ points: many(MAX_SCHEME_POINTS) }))), null);
    assert.equal(
      errorOf(parseLocationScheme(form({ points: many(MAX_SCHEME_POINTS + 1) }))),
      "Точек — не больше 100",
    );
  });

  test("испорченные данные — отказ", () => {
    assert.equal(errorOf(parseLocationScheme(form({ points: "{не json" }))), "Некорректные данные");
    assert.notEqual(errorOf(parseLocationScheme(form({ points: JSON.stringify({ a: 1 }) }))), null);
    assert.equal(errorOf(parseLocationScheme(form({ coordinates: 59 }))), "Некорректные координаты");
    assert.notEqual(errorOf(parseLocationScheme(form({ directions: 5 }))), null);
  });
});

describe("журнал: что поменялось", () => {
  const empty: LocationSchemeData = {
    latitude: null,
    longitude: null,
    directions: null,
    parking: null,
    onSiteNotes: null,
    points: [],
  };

  test("ничего не поменялось — писать не нужно", () => {
    assert.equal(locationSchemeChanges(empty, { ...empty }), null);
  });

  test("координаты, тексты коротко, точки — число и список", () => {
    const after: LocationSchemeData = {
      ...empty,
      latitude: 59.938,
      longitude: 30.314,
      parking: "п".repeat(100),
      points: [{ number: "1", name: "База", description: "двор" }],
    };
    assert.deepEqual(locationSchemeChanges(empty, after), {
      coordinates: { from: null, to: [59.938, 30.314] },
      parking: { from: null, to: `${"п".repeat(80)}…` },
      pointsCount: { from: 0, to: 1 },
      points: { from: [], to: ["1 База"] },
    });
  });

  test("поменялся только порядок точек — тоже изменение", () => {
    const a = { number: "1", name: "База", description: null };
    const b = { number: "2", name: "Грим", description: null };
    const changes = locationSchemeChanges({ ...empty, points: [a, b] }, { ...empty, points: [b, a] });
    assert.deepEqual(changes?.points, { from: ["1 База", "2 Грим"], to: ["2 Грим", "1 База"] });
  });
});
