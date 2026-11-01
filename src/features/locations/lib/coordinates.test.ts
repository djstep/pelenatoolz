import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  COORDINATES_FORMAT_ERROR,
  formatCoordinates,
  LATITUDE_RANGE_ERROR,
  LONGITUDE_RANGE_ERROR,
  parseCoordinates,
} from "@/features/locations/lib/coordinates";

const SPB = { latitude: 59.938, longitude: 30.314 };

describe("поле «Координаты»: варианты записи", () => {
  test("как копируют Яндекс и Google Карты и похожие записи", () => {
    for (const input of [
      "59.938, 30.314",
      "59.938,30.314",
      "59.938 30.314",
      "59.938; 30.314",
      "59.938;30.314",
      "59,938 30,314",
      "59,938; 30,314",
      "  59.938 ,   30.314  ",
      "59.938 30.314",
      "+59.938, +30.314",
    ]) {
      assert.deepEqual(parseCoordinates(input), SPB, input);
    }
  });

  test("минус: обычный и «−»", () => {
    assert.deepEqual(parseCoordinates("-33.8688, -70.6693"), {
      latitude: -33.8688,
      longitude: -70.6693,
    });
    assert.deepEqual(parseCoordinates("−33,8688 −70,6693"), {
      latitude: -33.8688,
      longitude: -70.6693,
    });
  });

  test("целые числа и лишние знаки после точки (до 6)", () => {
    assert.deepEqual(parseCoordinates("60, 30"), { latitude: 60, longitude: 30 });
    assert.deepEqual(parseCoordinates("59.93812345, 30.31412345"), {
      latitude: 59.938123,
      longitude: 30.314123,
    });
  });
});

describe("поле «Координаты»: границы", () => {
  test("90, −90, 180, −180 проходят", () => {
    assert.deepEqual(parseCoordinates("90, 180"), { latitude: 90, longitude: 180 });
    assert.deepEqual(parseCoordinates("-90, -180"), { latitude: -90, longitude: -180 });
    assert.deepEqual(parseCoordinates("0, 0"), { latitude: 0, longitude: 0 });
  });

  test("за границей — понятная ошибка", () => {
    assert.deepEqual(parseCoordinates("90.0001, 30"), { error: LATITUDE_RANGE_ERROR });
    assert.deepEqual(parseCoordinates("-91, 30"), { error: LATITUDE_RANGE_ERROR });
    assert.deepEqual(parseCoordinates("59, -180.5"), { error: LONGITUDE_RANGE_ERROR });
    assert.deepEqual(parseCoordinates("59, 181"), { error: LONGITUDE_RANGE_ERROR });
  });
});

describe("поле «Координаты»: пусто и мусор", () => {
  test("пусто и одни пробелы — координат нет", () => {
    assert.deepEqual(parseCoordinates(""), { latitude: null, longitude: null });
    assert.deepEqual(parseCoordinates("   "), { latitude: null, longitude: null });
  });

  test("мусор, одно число, три числа — ошибка формата", () => {
    for (const input of [
      "Санкт-Петербург",
      "59.938",
      "59.938, 30.314, 10",
      "59.938 30.314 10",
      "59.938;30.314;1",
      "abc, def",
      "59.938, ",
      ", 30.314",
      "59..938, 30.314",
      "1e2, 30",
      "59.938N, 30.314E",
      "59,938, 30,314",
    ]) {
      assert.deepEqual(parseCoordinates(input), { error: COORDINATES_FORMAT_ERROR }, input);
    }
  });
});

describe("координаты обратно в поле", () => {
  test("точка, «, », до 6 знаков без лишних нулей", () => {
    assert.equal(formatCoordinates(59.938, 30.314), "59.938, 30.314");
    assert.equal(formatCoordinates(59.93812345, -30.1), "59.938123, -30.1");
    assert.equal(formatCoordinates(60, 30), "60, 30");
    assert.equal(formatCoordinates(-0.0000001, 0), "0, 0");
  });

  test("нет широты или долготы — пусто", () => {
    assert.equal(formatCoordinates(null, null), "");
    assert.equal(formatCoordinates(59.9, null), "");
    assert.equal(formatCoordinates(undefined, 30), "");
  });

  test("показанное поле разбирается обратно в те же числа", () => {
    const text = formatCoordinates(-33.868812, 151.209295);
    assert.deepEqual(parseCoordinates(text), { latitude: -33.868812, longitude: 151.209295 });
  });
});
