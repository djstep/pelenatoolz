import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import type { DayDocBundle } from "@/features/day-docs/lib/build-day-doc";
import {
  ATTENDANCE_ACTOR_COLUMNS,
  buildAttendanceActorRows,
  buildAttendanceActorTables,
  buildAttendancePlaceLine,
  buildAttendanceSheetModel,
  formatAttendanceDate,
  pickOtherUnitDayIds,
} from "@/features/day-docs/lib/export-attendance-sheet";
import { buildAttendanceSheetXlsx } from "@/features/day-docs/lib/export-attendance-sheet-xlsx";

type Character = { id: string; name: string };
type Location = { name: string; address: string | null };

function scene(number: string, characters: Character[], locations: Location[] = []) {
  return {
    scene: {
      number,
      postfix: "",
      episodeNumber: 0,
      characters: characters.map((character) => ({ character })),
      locations: locations.map((location) => ({ location })),
    },
  };
}

function actor(
  id: string,
  characterId: string,
  lastName: string,
  firstName: string,
  middleName: string | null = null,
) {
  return {
    id,
    characterId,
    lastName,
    firstName,
    middleName,
    phone1: "+7 900 000-00-00",
    phone2: null,
    email: "actor@example.com",
    roleType: "MAIN",
    carPickupTime: null,
    arrivalTime: null,
  };
}

function bundle(opts: {
  unit?: string | null;
  scenes: ReturnType<typeof scene>[];
  actors?: ReturnType<typeof actor>[];
  actorCalls?: { actorId: string; arrivalTime: string | null }[];
}): DayDocBundle {
  return {
    project: {
      id: "p1",
      name: "Кино",
      fullName: "Большое кино",
      city: "Москва",
      timezone: "Europe/Moscow",
    },
    day: {
      id: `d-${opts.unit ?? "main"}`,
      // Как в базе: полночь 01.11 по Москве.
      date: new Date("2026-10-31T21:00:00.000Z"),
      dayNumber: 3,
      unit: opts.unit === undefined ? "main" : opts.unit,
      scenes: opts.scenes,
      actorCalls: (opts.actorCalls ?? []).map((c) => ({
        pickupTime: null,
        makeupTime: null,
        costumeTime: null,
        readyTime: null,
        wrapTime: null,
        ...c,
      })),
      departmentCalls: [],
      transports: [],
      resourceCalls: [],
      resourceUsages: [],
      timeSlots: [],
    },
    actors: opts.actors ?? [],
  } as unknown as DayDocBundle;
}

const ivan = { id: "c-ivan", name: "Иван" };
const anna = { id: "c-anna", name: "Анна" };
const boris = { id: "c-boris", name: "Борис" };

const mainDay = bundle({
  scenes: [
    scene("1", [ivan, anna], [{ name: "Квартира", address: "ул. Ленина, 1" }]),
    scene("2", [boris, anna], [
      { name: "Двор", address: null },
      { name: "Квартира", address: "ул. Ленина, 1" },
    ]),
  ],
  actors: [
    actor("a-anna", "c-anna", "Петрова", "Анна", "Сергеевна"),
    actor("a-ivan", "c-ivan", "Сидоров", "Иван"),
  ],
  actorCalls: [
    { actorId: "a-anna", arrivalTime: "08:30" },
    { actorId: "a-ivan", arrivalTime: "07:00" },
  ],
});

describe("buildAttendanceActorRows", () => {
  test("порядок — как в актёрском блоке вызывного (по персонажу)", () => {
    const rows = buildAttendanceActorRows(mainDay);
    assert.deepEqual(
      rows.map((r) => r.character),
      ["Анна", "Борис", "Иван"],
    );
  });

  test("актёр — «Фамилия Имя» без отчества, вызов — из вызывного дня", () => {
    const rows = buildAttendanceActorRows(mainDay);
    assert.deepEqual(rows[0], { actor: "Петрова Анна", character: "Анна", callTime: "08:30" });
    assert.deepEqual(rows[2], { actor: "Сидоров Иван", character: "Иван", callTime: "07:00" });
  });

  test("персонаж без актёра — «не назначен», без вызова", () => {
    const rows = buildAttendanceActorRows(mainDay);
    assert.deepEqual(rows[1], { actor: "не назначен", character: "Борис", callTime: null });
  });

  test("в строке нет телефонов, почты и ставок", () => {
    for (const row of buildAttendanceActorRows(mainDay)) {
      assert.deepEqual(Object.keys(row).sort(), ["actor", "callTime", "character"]);
    }
  });
});

describe("buildAttendancePlaceLine", () => {
  test("адреса объектов дня через «; », без повторов; без адреса — название", () => {
    assert.equal(
      buildAttendancePlaceLine(mainDay),
      "Место съёмки: ул. Ленина, 1; Двор",
    );
  });

  test("объектов нет — прочерк", () => {
    assert.equal(
      buildAttendancePlaceLine(bundle({ scenes: [scene("1", [ivan])] })),
      "Место съёмки: —",
    );
  });
});

describe("formatAttendanceDate", () => {
  test("ДД.ММ.ГГГГ по часовому поясу проекта, без пояса — Москва", () => {
    const stored = new Date("2026-11-30T21:00:00.000Z");
    assert.equal(formatAttendanceDate(stored, "Europe/Moscow"), "01.12.2026");
    assert.equal(formatAttendanceDate(stored, null), "01.12.2026");
    assert.equal(formatAttendanceDate(stored, "Europe/London"), "30.11.2026");
  });
});

describe("группы съёмки", () => {
  const secondUnit = bundle({
    unit: "2-й юнит",
    scenes: [scene("5", [boris], [{ name: "Поле", address: "Подмосковье" }])],
  });

  test("одна основная группа — шапка без группы, лист «Актёры»", () => {
    const [table, ...rest] = buildAttendanceActorTables([mainDay]);
    assert.equal(rest.length, 0);
    assert.equal(table.title, "Явочный лист «Большое кино» 01.11.2026");
    assert.equal(table.sheetName, "Актёры");
  });

  test("несколько групп — по таблице на группу, основная первой", () => {
    const tables = buildAttendanceActorTables([secondUnit, mainDay]);
    assert.deepEqual(
      tables.map((t) => [t.unit, t.sheetName, t.title]),
      [
        ["main", "Актёры · Основная", "Явочный лист «Большое кино» 01.11.2026 · Основная группа"],
        ["2-й юнит", "Актёры · 2-й юнит", "Явочный лист «Большое кино» 01.11.2026 · 2-й юнит"],
      ],
    );
    assert.deepEqual(tables[1].rows, [{ actor: "не назначен", character: "Борис", callTime: null }]);
    assert.equal(tables[1].placeLine, "Место съёмки: Подмосковье");
  });

  test("единственная группа не основная — группа в шапке", () => {
    const [table] = buildAttendanceActorTables([secondUnit]);
    assert.equal(table.title, "Явочный лист «Большое кино» 01.11.2026 · 2-й юнит");
  });

  test("дни той же даты — по одному на группу, группа выгружаемого дня не повторяется", () => {
    assert.deepEqual(
      pickOtherUnitDayIds("main", [
        { id: "x", unit: "2-й юнит", dayNumber: 9 },
        { id: "y", unit: null, dayNumber: 4 },
        { id: "z", unit: "2-й юнит", dayNumber: 7 },
        { id: "w", unit: "  ", dayNumber: 5 },
      ]),
      ["z"],
    );
  });
});

describe("buildAttendanceSheetXlsx", () => {
  test("лист актёров: шапка, колонки, пустые для ручки, без телефонов, печать A4 альбомная", async () => {
    const model = buildAttendanceSheetModel(mainDay, { resourceIds: [] }, []);
    const buffer = await buildAttendanceSheetXlsx(model);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);

    assert.deepEqual(
      wb.worksheets.map((s) => s.name),
      ["Актёры", "Цеха"],
    );
    const sheet = wb.getWorksheet("Актёры")!;
    assert.equal(sheet.getCell("A1").value, "Явочный лист «Большое кино» 01.11.2026");
    assert.equal(sheet.getCell("A1").font?.bold, true);
    assert.equal(sheet.getCell("A2").value, "Место съёмки: ул. Ленина, 1; Двор");

    const header = sheet.getRow(4);
    assert.deepEqual(
      ATTENDANCE_ACTOR_COLUMNS.map((_, i) => header.getCell(i + 1).value),
      [...ATTENDANCE_ACTOR_COLUMNS],
    );
    assert.equal(header.getCell(1).font?.bold, true);

    const first = sheet.getRow(5);
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7].map((c) => first.getCell(c).value ?? ""),
      ["Петрова Анна", "Анна", "08:30", "", "", "", ""],
    );
    assert.ok((first.height ?? 0) >= 23, "строка ≥ 8 мм под подпись");

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        assert.ok(!String(cell.value).includes("+7"), "телефонов нет");
        assert.ok(!String(cell.value).includes("@"), "почты нет");
        const fill = cell.fill as ExcelJS.FillPattern | undefined;
        assert.ok(!fill || fill.pattern === "none", "без заливки");
      });
    });

    assert.equal(sheet.pageSetup.orientation, "landscape");
    assert.equal(sheet.pageSetup.paperSize, 9);
    assert.equal(sheet.pageSetup.fitToWidth, 1);
    assert.equal(sheet.pageSetup.printTitlesRow, "4:4");
    assert.equal(sheet.getImages().length, 0, "без логотипа, если его не передали");
  });

  test("логотип — справа над таблицей, на каждом актёрском листе; шапка не заходит под него", async () => {
    const logo = fs.readFileSync(path.join(process.cwd(), "public", "brand", "pelena-black.png"));
    const secondUnit = bundle({ unit: "2-й юнит", scenes: [scene("5", [boris])] });
    const model = buildAttendanceSheetModel(mainDay, { resourceIds: [] }, [], [secondUnit]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildAttendanceSheetXlsx(model, logo)) as ArrayBuffer);

    for (const name of ["Актёры · Основная", "Актёры · 2-й юнит"]) {
      const sheet = wb.getWorksheet(name)!;
      const images = sheet.getImages();
      assert.equal(images.length, 1, name);
      const tl = images[0].range.tl;
      assert.ok(tl.nativeRow === 0, "в первой строке, над таблицей");
      assert.ok(tl.nativeCol >= ACTOR_TITLE_LAST_COL, "правее шапки — над «Переработкой» и «Подписью»");
      assert.equal(sheet.getCell("F1").isMerged, false, "шапка объединена только до «Конца смены»");
    }
    assert.equal(wb.getWorksheet("Цеха")!.getImages().length, 0, "прочие листы без логотипа");
  });
});

/** Индекс (с 0) первой колонки правее шапки: «Переработка». */
const ACTOR_TITLE_LAST_COL = 5;
