import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { formatFileDate } from "@/shared/i18n/format-date";

describe("formatFileDate", () => {
  test("день, сохранённый полночью по Москве, — своя дата, а не вчерашняя по UTC", () => {
    assert.equal(formatFileDate(new Date("2027-01-14T21:00:00.000Z"), "Europe/Moscow"), "2027-01-15");
  });

  test("без пояса проекта — Москва", () => {
    assert.equal(formatFileDate(new Date("2027-01-14T21:00:00.000Z"), null), "2027-01-15");
    assert.equal(formatFileDate(new Date("2027-01-14T21:00:00.000Z")), "2027-01-15");
  });

  test("выгрузка в 01:30 по Москве — сегодняшняя дата, а не вчерашняя", () => {
    assert.equal(formatFileDate(new Date("2026-11-01T22:30:00.000Z"), "Europe/Moscow"), "2026-11-02");
  });

  test("другой пояс проекта", () => {
    const stored = new Date("2027-01-14T21:00:00.000Z");
    assert.equal(formatFileDate(stored, "Asia/Vladivostok"), "2027-01-15");
    assert.equal(formatFileDate(stored, "Europe/London"), "2027-01-14");
  });

  test("строка ГГГГ-ММ-ДД без пробелов и точек — годится для имени файла", () => {
    assert.match(formatFileDate("2026-03-02T21:00:00.000Z", "Europe/Moscow"), /^\d{4}-\d{2}-\d{2}$/);
  });
});
