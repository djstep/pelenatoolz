import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addMonthsToKey,
  calendarHref,
  eachDayKey,
  parseCalendarDate,
  parseCalendarView,
  stepDate,
  visibleRange,
} from "@/features/prep-calendar/lib/calendar-view";

describe("адрес календаря", () => {
  test("вид: только известные значения", () => {
    assert.equal(parseCalendarView("week"), "week");
    assert.equal(parseCalendarView("year"), null);
    assert.equal(parseCalendarView(["week"]), null);
    assert.equal(parseCalendarView(undefined), null);
  });

  test("дата: мусор и несуществующие даты заменяются запасной", () => {
    const today = "2026-11-07";
    assert.equal(parseCalendarDate("2026-12-01", today), "2026-12-01");
    for (const bad of ["2026-02-30", "завтра", "", ["2026-12-01"], undefined, "1500-01-01"]) {
      assert.equal(parseCalendarDate(bad, today), today, String(bad));
    }
  });

  test("ссылка содержит вид и дату", () => {
    assert.equal(calendarHref("/c", "week", "2026-11-10"), "/c?view=week&date=2026-11-10");
  });
});

describe("видимые дни", () => {
  test("неделя: с понедельника по воскресенье", () => {
    assert.deepEqual(visibleRange("week", "2026-11-11"), { from: "2026-11-09", to: "2026-11-15" });
    assert.deepEqual(visibleRange("week", "2026-11-15"), { from: "2026-11-09", to: "2026-11-15" });
    assert.deepEqual(visibleRange("week", "2026-11-09"), { from: "2026-11-09", to: "2026-11-15" });
  });

  test("месяц: полными неделями, захватывает соседние месяцы", () => {
    assert.deepEqual(visibleRange("month", "2026-11-20"), { from: "2026-10-26", to: "2026-12-06" });
  });

  test("список: ровно месяц, февраль високосного года", () => {
    assert.deepEqual(visibleRange("list", "2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
  });

  test("в неделе 7 дней, в сетке месяца кратно 7", () => {
    assert.equal(eachDayKey(visibleRange("week", "2026-11-11")).length, 7);
    assert.equal(eachDayKey(visibleRange("month", "2026-11-20")).length % 7, 0);
  });
});

describe("вперёд и назад", () => {
  test("неделя на 7 дней, через границу года", () => {
    assert.equal(stepDate("week", "2026-12-28", 1), "2027-01-04");
    assert.equal(stepDate("week", "2027-01-04", -1), "2026-12-28");
  });

  test("месяц: 31 января → последний день февраля", () => {
    assert.equal(addMonthsToKey("2026-01-31", 1), "2026-02-28");
    assert.equal(stepDate("month", "2026-12-15", 1), "2027-01-15");
    assert.equal(stepDate("list", "2026-01-15", -1), "2025-12-15");
  });
});
