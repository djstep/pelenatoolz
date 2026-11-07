import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseByteRange } from "./byte-range";

describe("заголовок Range", () => {
  test("обычные запросы браузеров", () => {
    assert.deepEqual(parseByteRange("bytes=0-1", 100), { start: 0, end: 1 });
    assert.deepEqual(parseByteRange("bytes=0-", 100), { start: 0, end: 99 });
    assert.deepEqual(parseByteRange("bytes=50-59", 100), { start: 50, end: 59 });
    assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  });

  test("конец за пределами файла обрезается", () => {
    assert.deepEqual(parseByteRange("bytes=90-500", 100), { start: 90, end: 99 });
    assert.deepEqual(parseByteRange("bytes=-500", 100), { start: 0, end: 99 });
  });

  test("начало за концом файла — 416", () => {
    assert.equal(parseByteRange("bytes=100-", 100), "unsatisfiable");
    assert.equal(parseByteRange("bytes=100-200", 100), "unsatisfiable");
    assert.equal(parseByteRange("bytes=-0", 100), "unsatisfiable");
    assert.equal(parseByteRange("bytes=0-", 0), "unsatisfiable");
  });

  test("всё непонятное — файл целиком", () => {
    for (const header of [null, "", "bytes=", "bytes=-", "items=0-1", "bytes=0-1,3-4", "bytes=a-b", "bytes=5-2"]) {
      assert.equal(parseByteRange(header, 100), null, String(header));
    }
  });
});
