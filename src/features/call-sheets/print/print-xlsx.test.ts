import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import { isFormulaLike } from "@/shared/lib/excel-safe";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";
import {
  buildCallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import {
  FULL_DAY_SOURCE,
  IRP_DAY_SOURCE,
  MIN_DAY_SOURCE,
} from "@/features/call-sheets/print/preview-fixtures";
import {
  buildCallSheetWorkbook,
  CALL_SHEET_XLSX_SHEET_NAME,
  writeCallSheetXlsx,
} from "@/features/call-sheets/print/print-xlsx";

function clone(source: CallSheetPrintSource): CallSheetPrintSource {
  return structuredClone(source);
}

function book(source: CallSheetPrintSource) {
  return buildCallSheetWorkbook(buildCallSheetPrintModel(source));
}

type CellInfo = { row: number; col: number; value: unknown; bold: boolean };

/** Все непустые ячейки книги (у объединённых — только главная). */
function cells(workbook: ExcelJS.Workbook): CellInfo[] {
  const out: CellInfo[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, col) => {
        if (cell.isMerged && cell.master !== cell) return;
        out.push({ row: rowNumber, col, value: cell.value, bold: Boolean(cell.font?.bold) });
      });
    });
  });
  return out;
}

function strings(workbook: ExcelJS.Workbook): string[] {
  return cells(workbook)
    .map((c) => c.value)
    .filter((v): v is string => typeof v === "string");
}

function allText(workbook: ExcelJS.Workbook) {
  return strings(workbook).join("\n");
}

/** Заголовок блока → строка листа (ячейка A). */
function titleRow(workbook: ExcelJS.Workbook, title: string) {
  return cells(workbook).find((c) => c.col === 1 && c.value === title);
}

async function toBuffer(source: CallSheetPrintSource): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const ended = once(stream, "end");
  await writeCallSheetXlsx(buildCallSheetPrintModel(source), stream);
  await ended;
  return Buffer.concat(chunks);
}

describe("вызывной в Excel", () => {
  test("строки, похожие на формулы, — с апострофом; ни одна ячейка не начинается со знака формулы", () => {
    const source = clone(FULL_DAY_SOURCE);
    source.project.fullName = "=cmd|' /C calc'!A0";
    source.day.crewMeetAddress = "+79990000000 адрес";
    source.sheet!.leaders[0]!.personName = '=HYPERLINK("http://evil","x")';
    source.sheet!.importantNote = "-важно";
    source.sheet!.crewCalls[0]!.label = "@цех";
    source.sheet!.schemeLocation!.address = "=адрес схемы";
    source.elements!.manual.push({
      ...source.elements!.manual[2]!,
      name: "+cmd|' /C calc'!A0",
      notes: "-x",
    });
    source.day.transports[0]!.notes = "-примечание";
    source.day.scenes[0]!.scene.characters[0]!.character.name = "@cmd";
    source.day.timeSlots[2]!.notes = "=note";

    const workbook = book(source);
    const values = strings(workbook);
    for (const expected of [
      "'=cmd|' /C calc'!A0",
      `'=HYPERLINK("http://evil","x")`,
      "'-важно",
      "'@цех",
      "'=адрес схемы",
      "'+cmd|' /C calc'!A0",
      "'-x",
      "'-примечание",
      "'@cmd",
    ]) {
      assert.ok(values.includes(expected), `нет ячейки ${expected}`);
    }
    // Место сбора — с пометкой о схеме; персонажи строки плана начинаются с «@cmd».
    assert.ok(values.some((v) => v.startsWith("'+79990000000 адрес")));
    assert.ok(values.some((v) => v.startsWith("'@cmd, ")));
    for (const value of values) {
      assert.ok(!isFormulaLike(value), `ячейка похожа на формулу: ${value}`);
    }
    // Телефон и температура со знаком — без апострофа.
    assert.ok(values.includes("+7 921 555-01-01"));
    assert.ok(!values.some((v) => v.startsWith("'+7 921")));
    assert.ok(values.includes("+6°"));
  });

  test("ставки км нет", () => {
    const source = clone(FULL_DAY_SOURCE);
    for (const row of source.day.transports) {
      (row as typeof row & { ratePerKm: number }).ratePerKm = 12345;
    }
    const text = allText(book(source));
    assert.ok(text.includes("Дождевальная машина (АЦ-40)"), "спецтранспорт выведен");
    assert.ok(!text.includes("12345"));
    assert.doesNotMatch(text, /(^|[^а-яё])км([^а-яё]|$)/i);
    assert.doesNotMatch(text, /ставк/i);
  });

  test("телефонов актёров нет, телефон руководителя есть", () => {
    const source = clone(FULL_DAY_SOURCE);
    for (const actor of source.actors) {
      (actor as typeof actor & { phone: string }).phone = "+7 999 111-22-33";
    }
    const text = allText(book(source));
    assert.ok(!text.includes("999 111-22-33"));
    assert.ok(text.includes("+7 921 555-01-01"));
    assert.ok(text.includes("Соколова Мария"), "актёры выведены");
  });

  test("один лист, блоки в порядке листа печати, заголовки жирные", () => {
    const model = buildCallSheetPrintModel(FULL_DAY_SOURCE);
    const workbook = buildCallSheetWorkbook(model);
    assert.equal(workbook.worksheets.length, 1);
    assert.equal(workbook.worksheets[0]!.name, CALL_SHEET_XLSX_SHEET_NAME);
    assert.ok(CALL_SHEET_XLSX_SHEET_NAME.length <= 31);
    assert.doesNotMatch(CALL_SHEET_XLSX_SHEET_NAME, /[\\/?*[\]:]/);

    const h2 = [...buildCallSheetHtml(model).matchAll(/<h2>(.*?)<\/h2>/g)].map((m) => m[1]!);
    assert.ok(h2.length >= 8, "в HTML есть заголовки блоков");
    const rows = h2.map((title) => {
      const found = titleRow(workbook, title.toLocaleUpperCase("ru-RU"));
      assert.ok(found, `нет блока ${title}`);
      assert.ok(found.bold, `заголовок ${title} не жирный`);
      return found.row;
    });
    assert.deepEqual(rows, [...rows].sort((a, b) => a - b));

    // Шапка, времена, сведения и «Важно» — до руководителей, как на листе.
    const order = ["ВЫЗЫВНОЙ ЛИСТ", "ВРЕМЕНА", "ПОГОДА", "ОБЪЕКТЫ", "ОГРАНИЧЕНИЯ ПО АКТЁРАМ", "ВАЖНО"].map(
      (title) => titleRow(workbook, title)!.row,
    );
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(order[order.length - 1]! < rows[0]!);
    assert.equal(titleRow(workbook, "ВЫЗЫВНОЙ ЛИСТ")!.row, 1);
  });

  test("пустые блоки не выводятся", () => {
    const workbook = book(MIN_DAY_SOURCE);
    for (const title of ["ВЫЗОВ ЦЕХОВ", "ВАЖНО", "ОГРАНИЧЕНИЯ ПО АКТЁРАМ", "СХЕМА ОБЪЕКТА", "ВТОРОЙ ЮНИТ", "ПОГОДА"]) {
      assert.equal(titleRow(workbook, title), undefined, title);
    }
    assert.ok(titleRow(workbook, "РУКОВОДИТЕЛИ ГРУППЫ"));
    assert.ok(titleRow(workbook, "АКТЁРЫ"));
  });

  test("план: время, хронометраж строками как в модели", () => {
    const model = buildCallSheetPrintModel(IRP_DAY_SOURCE);
    const values = strings(buildCallSheetWorkbook(model));
    assert.ok(values.includes("09:30"));
    assert.ok(values.includes(model.totals.mainTiming!));
    assert.ok(values.includes("Итого хронометраж основного юнита"));
  });

  test("запись в поток даёт валидный xlsx", async () => {
    const buffer = await toBuffer(FULL_DAY_SOURCE);
    assert.equal(buffer.subarray(0, 2).toString("latin1"), "PK");
    const loaded = await new ExcelJS.Workbook().xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
    assert.equal(loaded.worksheets.length, 1);
    const title = titleRow(loaded, "АКТЁРЫ");
    assert.ok(title?.bold);
    assert.ok(allText(loaded).includes("Соколова Мария"));
  });
});
