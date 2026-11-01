import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import {
  CALL_SHEET_CACHE_CONTROL,
  callSheetSheetResponse,
  callSheetXlsxResponse,
} from "@/features/call-sheets/print/http-responses";
import { MEDEO_FONT_FILE_NAME } from "@/features/call-sheets/print/medeo-font";
import { buildCallSheetPrintModel } from "@/features/call-sheets/print/print-model";
import { IRP_DAY_SOURCE } from "@/features/call-sheets/print/preview-fixtures";

/** Ответы маршрутов листа (`…/sheet`) и Excel (`…/xlsx`) вызывного: заголовки кэша и защиты. */

const loaded = () => {
  const model = buildCallSheetPrintModel(IRP_DAY_SOURCE);
  return { model, fileBaseName: "Вызывной ИРП 11.09.2026" };
};

const denied = { error: "Недостаточно прав", status: 403 as const };
const notFound = { error: "Съёмочный день не найден", status: 404 as const };

describe("заголовки маршрутов вызывного", () => {
  test("лист: private, no-store; HTML, CSP с песочницей без скриптов", async () => {
    assert.equal(CALL_SHEET_CACHE_CONTROL, "private, no-store");
    const res = callSheetSheetResponse(loaded());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.equal(res.headers.get("Content-Type"), "text/html; charset=utf-8");
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    assert.match(csp, /script-src 'none'/);
    assert.match(csp, /sandbox allow-same-origin/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.doesNotMatch(csp, /allow-scripts/);
    const body = await res.text();
    assert.ok(body.includes(MEDEO_FONT_FILE_NAME), "шрифт по адресу");
    assert.ok(!body.includes("base64"), "шрифт не встроен");
  });

  test("лист: отказ и «не найден» — тоже не кэшируются", async () => {
    for (const result of [denied, notFound]) {
      const res = callSheetSheetResponse(result);
      assert.equal(res.status, result.status);
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      assert.equal(await res.text(), result.error);
    }
  });

  test("Excel: private, no-store, attachment с кириллицей; файл читается", async () => {
    const res = callSheetXlsxResponse(loaded());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Cache-Control"), "private, no-store");
    assert.match(res.headers.get("Content-Type") ?? "", /spreadsheetml\.sheet$/);
    assert.match(res.headers.get("Content-Disposition") ?? "", /^attachment; .*filename\*=UTF-8''/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await res.arrayBuffer());
    assert.equal(book.worksheets.length, 1);
  });

  test("Excel: отказ и «не найден» — JSON, не кэшируются", async () => {
    for (const result of [denied, notFound]) {
      const res = callSheetXlsxResponse(result);
      assert.equal(res.status, result.status);
      assert.equal(res.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(await res.json(), { error: result.error });
    }
  });
});
