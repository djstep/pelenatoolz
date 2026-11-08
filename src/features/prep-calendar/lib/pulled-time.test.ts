import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeSourceTime, plusMinutes } from "@/features/prep-calendar/lib/pulled-time";

describe("время из источника", () => {
  test("разные записи часов приводятся к ЧЧ:ММ", () => {
    assert.equal(normalizeSourceTime("9:30"), "09:30");
    assert.equal(normalizeSourceTime(" 09.30 "), "09:30");
    assert.equal(normalizeSourceTime("23:59"), "23:59");
  });

  test("не время — весь день", () => {
    for (const value of ["после обеда", "24:00", "12:60", "1230", "", null, undefined]) {
      assert.equal(normalizeSourceTime(value), null, String(value));
    }
  });

  test("час пробы: в тот же день и через полночь", () => {
    assert.deepEqual(plusMinutes("2026-11-10", "10:00", 60), { endKey: "2026-11-10", endTime: "11:00" });
    assert.deepEqual(plusMinutes("2026-11-10", "23:30", 60), { endKey: "2026-11-11", endTime: "00:30" });
    assert.deepEqual(plusMinutes("2026-12-31", "23:00", 60), { endKey: "2027-01-01", endTime: "00:00" });
  });
});
