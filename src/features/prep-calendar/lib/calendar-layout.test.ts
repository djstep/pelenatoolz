import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  compareInDay,
  eventDayKeys,
  eventsByDay,
  placeInColumns,
  segmentForDay,
} from "@/features/prep-calendar/lib/calendar-layout";

const timed = (startKey: string, startTime: string, endKey: string, endTime: string) => ({
  allDay: false,
  startKey,
  endKey,
  startTime,
  endTime,
});
const allDay = (startKey: string, endKey: string) => ({
  allDay: true,
  startKey,
  endKey,
  startTime: null,
  endTime: null,
});

describe("дни события", () => {
  test("весь день на несколько дней", () => {
    assert.deepEqual(eventDayKeys(allDay("2026-11-10", "2026-11-12")), [
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
  });

  test("событие через полночь занимает оба дня", () => {
    const event = timed("2026-11-10", "22:00", "2026-11-11", "02:00");
    assert.deepEqual(eventDayKeys(event), ["2026-11-10", "2026-11-11"]);
    assert.deepEqual(segmentForDay(event, "2026-11-10"), { startMin: 1320, endMin: 1440 });
    assert.deepEqual(segmentForDay(event, "2026-11-11"), { startMin: 0, endMin: 120 });
  });

  test("окончание ровно в полночь следующий день не занимает", () => {
    const event = timed("2026-11-10", "22:00", "2026-11-11", "00:00");
    assert.deepEqual(eventDayKeys(event), ["2026-11-10"]);
    assert.deepEqual(segmentForDay(event, "2026-11-10"), { startMin: 1320, endMin: 1440 });
  });

  test("начало равно концу: один день, нулевая длина", () => {
    const event = timed("2026-11-10", "00:00", "2026-11-10", "00:00");
    assert.deepEqual(eventDayKeys(event), ["2026-11-10"]);
    assert.deepEqual(segmentForDay(event, "2026-11-10"), { startMin: 0, endMin: 0 });
  });

  test("вне показанных дней событие не теряет остальные дни", () => {
    const days = ["2026-11-11", "2026-11-12"];
    const event = allDay("2026-11-10", "2026-11-11");
    const map = eventsByDay([event], days);
    assert.deepEqual(map.get("2026-11-11"), [event]);
    assert.deepEqual(map.get("2026-11-12"), []);
    assert.equal(map.has("2026-11-10"), false);
  });

  test("в дне сначала весь день, потом по времени", () => {
    const morning = timed("2026-11-10", "09:00", "2026-11-10", "10:00");
    const evening = timed("2026-11-10", "18:00", "2026-11-10", "19:00");
    const whole = allDay("2026-11-10", "2026-11-10");
    assert.deepEqual([evening, whole, morning].sort(compareInDay), [whole, morning, evening]);
  });
});

describe("раскладка дня", () => {
  const seg = (item: string, startMin: number, endMin: number) => ({ item, startMin, endMin });
  const byItem = <T extends { item: string }>(rows: T[]) =>
    Object.fromEntries(rows.map((row) => [row.item, row]));

  test("события подряд стоят во всю ширину", () => {
    const rows = byItem(placeInColumns([seg("a", 60, 120), seg("b", 120, 180)]));
    assert.equal(rows.a!.columns, 1);
    assert.equal(rows.b!.columns, 1);
  });

  test("пересекающиеся делят ширину", () => {
    const rows = byItem(placeInColumns([seg("a", 60, 180), seg("b", 120, 240)]));
    assert.equal(rows.a!.columns, 2);
    assert.equal(rows.b!.columns, 2);
    assert.notEqual(rows.a!.column, rows.b!.column);
  });

  test("цепочка: третье занимает освободившуюся полосу", () => {
    const rows = byItem(
      placeInColumns([seg("a", 0, 120), seg("b", 60, 180), seg("c", 120, 240)]),
    );
    assert.equal(rows.c!.column, rows.a!.column);
    assert.equal(rows.c!.columns, 2);
  });

  test("короткое событие считается не меньше получаса: тексты не наезжают", () => {
    const rows = byItem(placeInColumns([seg("a", 60, 65), seg("b", 70, 120)]));
    assert.equal(rows.a!.columns, 2);
    assert.equal(rows.b!.columns, 2);
  });

  test("после разрыва новая группа снова во всю ширину", () => {
    const rows = byItem(
      placeInColumns([seg("a", 0, 60), seg("b", 30, 90), seg("c", 200, 260)]),
    );
    assert.equal(rows.c!.columns, 1);
    assert.equal(rows.c!.column, 0);
  });
});
