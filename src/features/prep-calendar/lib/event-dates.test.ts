import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isCalendarDateKey,
  prepEventRangeColumns,
  prepEventRangeError,
} from "@/features/prep-calendar/lib/event-dates";

describe("prepEventRangeError", () => {
  test("весь день: окончание в день начала можно, раньше нельзя", () => {
    const base = { allDay: true as const, startDate: "2026-11-10" };
    assert.equal(prepEventRangeError({ ...base, endDate: "2026-11-10" }), null);
    assert.equal(prepEventRangeError({ ...base, endDate: "2026-11-12" }), null);
    assert.equal(prepEventRangeError({ ...base, endDate: "2026-11-09" }), "Окончание раньше начала");
  });

  test("весь день: несуществующая дата и мусор не проходят", () => {
    const bad = ["2026-02-30", "2026-13-01", "10.11.2026", ""];
    for (const startDate of bad) {
      assert.equal(
        prepEventRangeError({ allDay: true, startDate, endDate: "2026-11-10" }),
        "Укажите даты",
        startDate,
      );
    }
  });

  test("со временем: окончание равно началу можно, раньше нельзя", () => {
    const startAt = new Date("2026-11-10T10:00:00Z");
    assert.equal(prepEventRangeError({ allDay: false, startAt, endAt: startAt }), null);
    assert.equal(
      prepEventRangeError({ allDay: false, startAt, endAt: new Date("2026-11-10T09:59:00Z") }),
      "Окончание раньше начала",
    );
  });

  test("со временем: пустое время не проходит", () => {
    const startAt = new Date("2026-11-10T10:00:00Z");
    assert.equal(
      prepEventRangeError({ allDay: false, startAt, endAt: new Date("") }),
      "Укажите дату и время",
    );
  });
});

describe("prepEventRangeColumns", () => {
  test("весь день: дата сохраняется как есть, без сдвига по поясу сервера", () => {
    const row = prepEventRangeColumns({
      allDay: true,
      startDate: "2026-10-31",
      endDate: "2026-11-01",
    });
    assert.equal(row.startDate?.toISOString(), "2026-10-31T00:00:00.000Z");
    assert.equal(row.endDate?.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(row.startAt, null);
    assert.equal(row.endAt, null);
  });

  test("со временем: столбцы дат пустые", () => {
    const startAt = new Date("2026-11-10T10:00:00Z");
    const row = prepEventRangeColumns({ allDay: false, startAt, endAt: startAt });
    assert.equal(row.startDate, null);
    assert.equal(row.endDate, null);
    assert.equal(row.startAt, startAt);
  });
});

describe("isCalendarDateKey", () => {
  test("настоящая дата в годах 2000–2100", () => {
    assert.equal(isCalendarDateKey("2026-11-10"), true);
    assert.equal(isCalendarDateKey("2026-02-30"), false);
    assert.equal(isCalendarDateKey("1000-01-01"), false);
    assert.equal(isCalendarDateKey("9999-12-31"), false);
  });
});
