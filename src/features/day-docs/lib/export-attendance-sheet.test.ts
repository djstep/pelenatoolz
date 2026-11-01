import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import type { DayDocBundle } from "@/features/day-docs/lib/build-day-doc";
import {
  ATTENDANCE_NO_CALL_SHEET,
  buildAttendanceSheetModel,
  type AttendanceCallSheetCrew,
} from "@/features/day-docs/lib/export-attendance-sheet";
import { buildAttendanceSheetXlsx } from "@/features/day-docs/lib/export-attendance-sheet-xlsx";
import { isFormulaLike } from "@/shared/lib/excel-safe";

/** Явочный лист: вкладка «Цеха» — из нового вызывного, старая `DepartmentCallTime` не читается. */

const bundle = {
  project: { id: "p1", name: "ИРП", fullName: null, city: "СПб", timezone: "Europe/Moscow", currency: "RUB" },
  day: {
    id: "d1",
    date: new Date("2026-09-11T00:00:00Z"),
    dayNumber: 12,
    callTime: "07:00",
    shiftStartTime: "07:00",
    isNightShift: false,
    scenes: [],
    timeSlots: [],
    actorCalls: [],
    resourceCalls: [],
    resourceUsages: [],
    transports: [],
    // Старые строки, если бы их кто-то подложил, — в лист не попадают.
    departmentCalls: [{ roleLabel: "Старый цех", personName: "Старый Человек", phone: null, callTime: "05:00" }],
  },
  actors: [],
  projectScenes: [],
} as unknown as DayDocBundle;

const callSheet: AttendanceCallSheetCrew = {
  leaders: [
    { position: "Режиссёр-постановщик", shortTitle: "Режиссёр", personName: "Иванов Иван" },
    { position: "Второй режиссёр", shortTitle: null, personName: null },
  ],
  crewCalls: [
    { label: "Операторский цех", callTime: "06:30" },
    { label: "Грим", callTime: null },
  ],
};

function crewOf(sheet: AttendanceCallSheetCrew | null) {
  const model = buildAttendanceSheetModel(bundle, { resourceIds: [] }, [], sheet);
  const crew = model.sections.find((s) => s.id === "crew");
  assert.ok(crew);
  return crew;
}

describe("явочный лист: вкладка «Цеха»", () => {
  test("руководители, затем цеха — из вызывного", () => {
    assert.deepEqual(crewOf(callSheet).rows, [
      { name: "Иванов Иван", detail: "Режиссёр", callTime: null },
      { name: "—", detail: "Второй режиссёр", callTime: null },
      { name: "Операторский цех", detail: null, callTime: "06:30" },
      { name: "Грим", detail: null, callTime: null },
    ]);
  });

  test("старые строки DepartmentCallTime не читаются", () => {
    const text = JSON.stringify(buildAttendanceSheetModel(bundle, { resourceIds: [] }, [], callSheet));
    assert.ok(!text.includes("Старый"));
  });

  test("вызывного нет — вкладка пустая с подсказкой «Создайте вызывной»", async () => {
    const crew = crewOf(null);
    assert.deepEqual(crew.rows, []);
    assert.equal(crew.emptyText, ATTENDANCE_NO_CALL_SHEET);
    assert.match(ATTENDANCE_NO_CALL_SHEET, /^Создайте вызывной/);

    const model = buildAttendanceSheetModel(bundle, { resourceIds: [] }, [], null);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildAttendanceSheetXlsx(model));
    const values: string[] = [];
    book.getWorksheet("Цеха")?.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value))));
    assert.ok(values.includes(ATTENDANCE_NO_CALL_SHEET));
    assert.ok(!values.includes("Старый Человек"));
  });

  test("DepartmentCallTime не загружается и не читается нигде, кроме схемы Prisma", () => {
    const queries = readFileSync(path.join(process.cwd(), "src/features/day-docs/queries.ts"), "utf8");
    assert.ok(!queries.includes("departmentCalls"), "день КПП грузится без departmentCalls");
    const sheet = readFileSync(
      path.join(process.cwd(), "src/features/day-docs/lib/export-attendance-sheet.ts"),
      "utf8",
    );
    assert.ok(!/day\.departmentCalls|departmentCallTime\./.test(sheet));
  });
});

describe("явочный лист в Excel: защита от формул", () => {
  test("все строки — через excelSafe: формулы с апострофом, телефон и время как есть", async () => {
    const dangerous: AttendanceCallSheetCrew = {
      leaders: [{ position: "@SUM(A1)", shortTitle: null, personName: "=HYPERLINK(\"http://evil\",\"x\")" }],
      crewCalls: [{ label: "+cmd|' /C calc'!A0", callTime: "07:00" }, { label: "-2+3*cmd", callTime: null }],
    };
    const evilBundle = {
      ...bundle,
      project: { ...bundle.project, name: "=1+1", city: "\tгород" },
    } as unknown as DayDocBundle;
    const model = buildAttendanceSheetModel(evilBundle, { resourceIds: [] }, [], dangerous);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildAttendanceSheetXlsx(model));
    const values: string[] = [];
    book.eachSheet((sheet) =>
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          if (typeof cell.value === "string") values.push(cell.value);
        }),
      ),
    );
    for (const expected of [
      `'=HYPERLINK("http://evil","x")`,
      "'@SUM(A1)",
      "'+cmd|' /C calc'!A0",
      "'-2+3*cmd",
      "'=1+1",
      "07:00",
    ]) {
      assert.ok(values.includes(expected), `нет ячейки ${expected}`);
    }
    for (const value of values) {
      assert.ok(!isFormulaLike(value), `ячейка похожа на формулу: ${JSON.stringify(value)}`);
    }
  });
});
