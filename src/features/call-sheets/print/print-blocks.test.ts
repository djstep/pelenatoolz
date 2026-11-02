import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import {
  CALL_SHEET_BLOCKS,
  isCallSheetBlockEmpty,
  isCallSheetBlockShown,
  NOT_SPECIFIED,
  shiftTimes,
  shownCallSheetBlocks,
  type CallSheetBlockKey,
} from "@/features/call-sheets/print/print-blocks";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";
import {
  buildCallSheetPrintModel,
  type CallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import { buildCallSheetWorkbook } from "@/features/call-sheets/print/print-xlsx";
import {
  EMPTY_DAY_SOURCE,
  FULL_DAY_SOURCE,
  IRP_DAY_SOURCE,
  MIN_DAY_SOURCE,
} from "@/features/call-sheets/print/preview-fixtures";

const REQUIRED: CallSheetBlockKey[] = [
  "head",
  "times",
  "weather",
  "locations",
  "restrictions",
  "leaders",
  "crewCalls",
  "cast",
  "plan",
];
const OPTIONAL: CallSheetBlockKey[] = ["important", "base", "groups", "elements", "secondUnit", "scheme"];

function model(source: CallSheetPrintSource) {
  return buildCallSheetPrintModel(source);
}

/** День макета ИРП, где заполнены и ограничения по актёрам (в макете — «нет»). */
function filledSource(): CallSheetPrintSource {
  const source = structuredClone(IRP_DAY_SOURCE);
  source.sheet!.actorRestrictions = "Коллектор 2 — до 18:00";
  return source;
}

/** Заголовки блоков-таблиц в HTML (`<h2>`). */
function h2(page: string) {
  return [...page.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]!);
}

/** Заголовки блоков в Excel: жирные строки с заливкой заголовка, по порядку. */
function xlsxTitles(workbook: ExcelJS.Workbook) {
  const out: string[] = [];
  workbook.worksheets[0]!.eachRow((row) => {
    const cell = row.getCell(1);
    const fill = cell.fill as ExcelJS.FillPattern | undefined;
    if (typeof cell.value === "string" && fill?.fgColor?.argb === "FFFDF1EA" && cell.font?.size === 12) {
      out.push(cell.value);
    }
  });
  return out;
}

function xlsxText(workbook: ExcelJS.Workbook) {
  const parts: string[] = [];
  workbook.worksheets[0]!.eachRow((row) =>
    row.eachCell((cell) => {
      // У объединённых ячеек значение — только у главной.
      if (cell.isMerged && cell.master !== cell) return;
      if (typeof cell.value === "string") parts.push(cell.value);
    }),
  );
  return parts;
}

/** Блок → заголовок `<h2>` (у шапки, времён и строки сведений его нет). */
const HTML_TITLE: Partial<Record<CallSheetBlockKey, string>> = {
  leaders: "Руководители группы",
  crewCalls: "Вызов цехов",
  base: "База и транспорт группы",
  cast: "Актёры",
  groups: "Групповка и дублёры",
  elements: "Элементы площадки",
  plan: "План съёмки · основной юнит",
  secondUnit: "Второй юнит",
  scheme: "Схема объекта",
};

/** Блок → заголовок в Excel. */
const XLSX_TITLE: Record<CallSheetBlockKey, (m: CallSheetPrintModel) => string> = {
  head: () => "ВЫЗЫВНОЙ ЛИСТ",
  times: () => "ВРЕМЕНА",
  weather: () => "ПОГОДА",
  locations: (m) => (m.locations.length > 1 || (m.locations[0]?.rows.length ?? 0) > 1 ? "ОБЪЕКТЫ" : "ОБЪЕКТ"),
  restrictions: () => "ОГРАНИЧЕНИЯ ПО АКТЁРАМ",
  important: () => "ВАЖНО",
  leaders: () => "РУКОВОДИТЕЛИ ГРУППЫ",
  crewCalls: () => "ВЫЗОВ ЦЕХОВ",
  base: () => "БАЗА И ТРАНСПОРТ ГРУППЫ",
  cast: () => "АКТЁРЫ",
  groups: () => "ГРУППОВКА И ДУБЛЁРЫ",
  elements: () => "ЭЛЕМЕНТЫ ПЛОЩАДКИ",
  plan: () => "ПЛАН СЪЁМКИ · ОСНОВНОЙ ЮНИТ",
  secondUnit: () => "ВТОРОЙ ЮНИТ",
  scheme: () => "СХЕМА ОБЪЕКТА",
};

/** Опустошить один блок модели. */
const EMPTIED: Record<CallSheetBlockKey, (m: CallSheetPrintModel) => CallSheetPrintModel> = {
  head: (m) => ({ ...m, crewCall: { time: null, address: null } }),
  times: (m) => ({ ...m, times: [] }),
  weather: (m) => ({ ...m, weather: null }),
  locations: (m) => ({ ...m, locations: [] }),
  restrictions: (m) => ({ ...m, actorRestrictions: null }),
  important: (m) => ({ ...m, important: null }),
  leaders: (m) => ({ ...m, leaders: [] }),
  crewCalls: (m) => ({ ...m, crewCalls: [] }),
  base: (m) => ({ ...m, baseItems: [] }),
  cast: (m) => ({ ...m, cast: [] }),
  groups: (m) => ({ ...m, groups: [] }),
  elements: (m) => ({ ...m, elementSections: [] }),
  plan: (m) => ({ ...m, plan: [] }),
  secondUnit: (m) => ({ ...m, secondUnit: { range: null, rows: [] } }),
  scheme: (m) => ({ ...m, scheme: null }),
};

describe("правило пустых блоков вызывного", () => {
  test("порядок блоков — как в макете; обязательные и необязательные — по ТЗ", () => {
    assert.deepEqual(
      CALL_SHEET_BLOCKS.map((b) => b.key),
      ["head", "times", "weather", "locations", "restrictions", "important", "leaders", "crewCalls", "base", "cast", "groups", "elements", "plan", "secondUnit", "scheme"],
    );
    assert.deepEqual(CALL_SHEET_BLOCKS.filter((b) => b.required).map((b) => b.key), REQUIRED);
    assert.deepEqual(CALL_SHEET_BLOCKS.filter((b) => !b.required).map((b) => b.key), OPTIONAL);
  });

  test("пустой день: все блоки пусты, выводятся только обязательные", () => {
    const m = model(EMPTY_DAY_SOURCE);
    for (const { key } of CALL_SHEET_BLOCKS) assert.ok(isCallSheetBlockEmpty(m, key), key);
    assert.deepEqual(shownCallSheetBlocks(m), REQUIRED);
  });

  test("заполненный день (макет ИРП): выводятся все блоки по порядку", () => {
    const m = model(filledSource());
    for (const { key } of CALL_SHEET_BLOCKS) assert.ok(!isCallSheetBlockEmpty(m, key), key);
    assert.deepEqual(shownCallSheetBlocks(m), CALL_SHEET_BLOCKS.map((b) => b.key));
  });

  test("каждый блок по отдельности: обязательный пустой — остаётся, необязательный пустой — скрыт", () => {
    const full = model(filledSource());
    for (const { key, required } of CALL_SHEET_BLOCKS) {
      const m = EMPTIED[key](full);
      assert.ok(isCallSheetBlockEmpty(m, key), `${key} пуст`);
      assert.equal(isCallSheetBlockShown(m, key), required, key);
      // Остальные блоки от этого не меняются.
      for (const other of CALL_SHEET_BLOCKS) {
        if (other.key !== key) assert.ok(isCallSheetBlockShown(m, other.key), `${key} → ${other.key}`);
      }
    }
  });

  test("полоса времён: всегда пять полей по порядку, пустое — null; старый снимок с частью времён", () => {
    assert.deepEqual(
      shiftTimes(model(EMPTY_DAY_SOURCE)),
      [
        { label: "Смена", accent: false, value: null },
        { label: "Репетиция", accent: false, value: null },
        { label: "Мотор", accent: true, value: null },
        { label: "Обед", accent: false, value: null },
        { label: "Стоп-мотор", accent: true, value: null },
      ],
    );
    const snapshot = { ...model(EMPTY_DAY_SOURCE), times: [{ label: "Мотор", value: "09:30", accent: true }] };
    assert.deepEqual(
      shiftTimes(snapshot).map((t) => t.value),
      [null, null, "09:30", null, null],
    );
    assert.deepEqual(model(IRP_DAY_SOURCE).times.map((t) => t.label), ["Смена", "Репетиция", "Мотор", "Обед", "Стоп-мотор"]);
  });
});

describe("правило пустых блоков: печать и Excel", () => {
  test("печать пустого дня: обязательные блоки с «не указано» серым, необязательных нет", () => {
    const page = buildCallSheetHtml(model(EMPTY_DAY_SOURCE));
    assert.deepEqual(h2(page), ["Руководители группы", "Вызов цехов", "Актёры", "План съёмки · основной юнит"]);
    for (const label of ["Сбор группы", "Место сбора", "Смена", "Репетиция", "Мотор", "Обед", "Стоп-мотор", "Погода", "Объект", "Ограничения по актёрам"]) {
      assert.ok(page.includes(`>${label}</`), `есть «${label}»`);
    }
    // Сбор, место — 2; времена — 5; погода, объект, ограничения — 3; руководители, цеха, актёры, план — 4.
    const nv = page.match(new RegExp(`<span class="nv">${NOT_SPECIFIED}</span>`, "g")) ?? [];
    assert.equal(nv.length, 14);
    assert.match(page, /\.nv\{ color:var\(--faint\);/, "серым");
    for (const text of ["Важно", "База и транспорт", "Групповка", "Элементы площадки", "Второй юнит", "Схема объекта"]) {
      assert.ok(!page.includes(text), `нет «${text}»`);
    }
  });

  test("печать заполненного дня: «не указано» нет, все блоки на месте", () => {
    const page = buildCallSheetHtml(model(filledSource()));
    assert.ok(!page.includes(NOT_SPECIFIED));
    assert.deepEqual(h2(page), Object.values(HTML_TITLE));
  });

  test("Excel: те же блоки и тот же порядок, что в печати; «не указано» серым", () => {
    for (const source of [EMPTY_DAY_SOURCE, MIN_DAY_SOURCE, FULL_DAY_SOURCE, IRP_DAY_SOURCE, filledSource()]) {
      const m = model(source);
      const shown = shownCallSheetBlocks(m);
      assert.deepEqual(xlsxTitles(buildCallSheetWorkbook(m)), shown.map((key) => XLSX_TITLE[key](m)));
      assert.deepEqual(
        h2(buildCallSheetHtml(m)),
        shown.flatMap((key) => (HTML_TITLE[key] ? [HTML_TITLE[key]] : [])),
      );
    }
    const workbook = buildCallSheetWorkbook(model(EMPTY_DAY_SOURCE));
    const values = xlsxText(workbook);
    // Сбор и место — 2; пять времён; погода, объект, ограничения — 3; руководители, цеха, актёры, план — 4.
    assert.equal(values.filter((v) => v === NOT_SPECIFIED).length, 14);
    for (const label of ["Сбор группы", "Место сбора", "Смена", "Стоп-мотор"]) assert.ok(values.includes(label), label);
    workbook.worksheets[0]!.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value === NOT_SPECIFIED) assert.equal(cell.font?.color?.argb, "FF8A8A85");
      }),
    );
    assert.ok(!xlsxText(buildCallSheetWorkbook(model(filledSource()))).includes(NOT_SPECIFIED));
  });

  test("погода из прогноза: без температуры в описании и без повтора осадков", () => {
    const source = structuredClone(EMPTY_DAY_SOURCE);
    source.astro = {
      sunrise: "08:02",
      sunset: "16:24",
      weatherSummary: "Пасмурно, -1…2°C, осадки 27%",
      precipProb: 27,
      tempMax: 2,
      tempMin: -1,
    };
    const weather = model(source).weather!;
    assert.equal(weather.summary, "Пасмурно, осадки 27%");
    assert.equal(weather.tempDay, "+2°");
    assert.equal(weather.tempNight, "-1°");
    source.day.weatherPrecip = "небольшой дождь";
    assert.equal(model(source).weather!.summary, "Пасмурно, небольшой дождь");
  });
});
