import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  filtersToQuery,
  hasFilters,
  parseCalendarFilters,
} from "@/features/prep-calendar/lib/calendar-filters";

describe("фильтры календаря в адресе", () => {
  test("тип, цех и человек читаются и пишутся обратно", () => {
    const filters = parseCalendarFilters({ type: "t1", dept: "d1", person: "candidate:p1" });
    assert.deepEqual(filters, {
      typeId: "t1",
      departmentId: "d1",
      person: { kind: "candidate", id: "p1" },
    });
    assert.deepEqual(filtersToQuery(filters), { type: "t1", dept: "d1", person: "candidate:p1" });
    assert.equal(hasFilters(filters), true);
  });

  test("мусор не превращается в фильтр", () => {
    const filters = parseCalendarFilters({
      type: ["t1"],
      dept: "a b",
      person: "boss:p1",
    });
    assert.deepEqual(filters, { typeId: null, departmentId: null, person: null });
    assert.equal(hasFilters(filters), false);
    assert.deepEqual(filtersToQuery(filters), {});
  });

  test("человек без id или с чужими символами — без фильтра", () => {
    assert.equal(parseCalendarFilters({ person: "crew:" }).person, null);
    assert.equal(parseCalendarFilters({ person: "crew:{\"not\":1}" }).person, null);
  });
});
