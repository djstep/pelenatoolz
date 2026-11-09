import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  todayDateKey,
  zonedDateTime,
  zonedTimeToUtc,
} from "@/features/prep-calendar/lib/zoned-time";

describe("часы по поясу проекта → момент", () => {
  test("Москва: UTC+3", () => {
    assert.equal(
      zonedTimeToUtc("2026-11-10", "10:00", "Europe/Moscow").toISOString(),
      "2026-11-10T07:00:00.000Z",
    );
  });

  test("Новосибирск: UTC+7, полночь — прошлые сутки по UTC", () => {
    assert.equal(
      zonedTimeToUtc("2026-11-10", "00:00", "Asia/Novosibirsk").toISOString(),
      "2026-11-09T17:00:00.000Z",
    );
  });

  test("пояс с переводом часов: зимой и летом разное смещение", () => {
    assert.equal(
      zonedTimeToUtc("2026-01-15", "12:00", "Europe/Berlin").toISOString(),
      "2026-01-15T11:00:00.000Z",
    );
    assert.equal(
      zonedTimeToUtc("2026-07-15", "12:00", "Europe/Berlin").toISOString(),
      "2026-07-15T10:00:00.000Z",
    );
  });

  test("рядом с переводом часов время не уходит", () => {
    assert.equal(
      zonedTimeToUtc("2026-03-29", "01:30", "Europe/Berlin").toISOString(),
      "2026-03-29T00:30:00.000Z",
    );
    assert.equal(
      zonedTimeToUtc("2026-03-29", "03:30", "Europe/Berlin").toISOString(),
      "2026-03-29T01:30:00.000Z",
    );
  });

  test("туда и обратно даёт те же день и часы", () => {
    for (const timeZone of ["Europe/Moscow", "Asia/Vladivostok", "Europe/Kaliningrad", "UTC"]) {
      const date = zonedTimeToUtc("2026-12-31", "23:45", timeZone);
      assert.deepEqual(zonedDateTime(date, timeZone), { dateKey: "2026-12-31", time: "23:45" });
    }
  });
});

describe("момент → часы по поясу проекта", () => {
  test("один момент — разные сутки в разных поясах", () => {
    const date = new Date("2026-11-09T21:30:00Z");
    assert.deepEqual(zonedDateTime(date, "Europe/Moscow"), { dateKey: "2026-11-10", time: "00:30" });
    assert.deepEqual(zonedDateTime(date, "UTC"), { dateKey: "2026-11-09", time: "21:30" });
  });

  test("сегодня считается по поясу проекта", () => {
    const now = new Date("2026-11-09T21:30:00Z");
    assert.equal(todayDateKey("Europe/Moscow", now), "2026-11-10");
    assert.equal(todayDateKey("America/New_York", now), "2026-11-09");
  });
});
