import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  calendarExportCell,
  calendarExportColumns,
  calendarPrintColumns,
  groupCalendarItemsByDay,
} from "@/features/prep-calendar/lib/calendar-export";
import type { CalendarEvent, PulledItem } from "@/features/prep-calendar/lib/calendar-types";

const event: CalendarEvent = {
  id: "e1",
  title: "Читка сценария",
  type: { id: "t1", name: "Читка", color: "violet" },
  allDay: false,
  startKey: "2026-12-15",
  endKey: "2026-12-15",
  startTime: "10:00",
  endTime: "12:00",
  locationText: "зал 2",
  locationId: "l1",
  locationName: "Павильон",
  note: null,
  participants: [{ kind: "crew", id: "c1", label: "Иванов Пётр" }],
  hiddenCandidates: 2,
  departments: [{ id: "d1", name: "Операторский цех" }],
};

const pulled: PulledItem = {
  pulled: true,
  id: "kppPrep:s1",
  source: "kppPrep",
  title: "День 3",
  href: "/x",
  allDay: true,
  startKey: "2026-12-14",
  endKey: "2026-12-14",
  startTime: null,
  endTime: null,
  people: [],
  note: "Техпроход",
};

const col = (fieldIds: string[]) => ({ id: "x", title: "", fieldIds });

describe("выгрузка календаря", () => {
  test("ячейки своего события", () => {
    assert.equal(calendarExportCell(event, col(["time"])), "10:00–12:00");
    assert.equal(calendarExportCell(event, col(["kind"])), "Читка");
    assert.equal(calendarExportCell(event, col(["place"])), "Павильон, зал 2");
    assert.equal(calendarExportCell(event, col(["people"])), "Иванов Пётр, +2 кандидата");
    assert.equal(calendarExportCell(event, col(["title", "departments"])), "Читка сценария · Операторский цех");
  });

  test("подтянутая запись: источник словом, весь день", () => {
    assert.equal(calendarExportCell(pulled, col(["kind"])), "Подготовительный день (из КПП)");
    assert.equal(calendarExportCell(pulled, col(["time"])), "весь день");
    assert.equal(calendarExportCell(pulled, col(["note"])), "Техпроход");
  });

  test("неизвестные поля из запроса отбрасываются, пустые колонки тоже", () => {
    const columns = calendarExportColumns([col(["title", "phone"]), col(["salary"])]);
    assert.deepEqual(columns, [col(["title"])]);
  });

  test("в печати дата — заголовок дня, а не колонка", () => {
    assert.deepEqual(calendarPrintColumns([col(["date"]), col(["title"])]), [col(["title"])]);
  });

  test("группы по дню начала, по порядку", () => {
    const groups = groupCalendarItemsByDay([event, pulled]);
    assert.deepEqual(groups.map((group) => group.day), ["2026-12-14", "2026-12-15"]);
    assert.equal(groups[0]!.title, "Понедельник, 14 декабря 2026 г.");
  });
});
