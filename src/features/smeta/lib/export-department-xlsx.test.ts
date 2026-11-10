import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import {
  buildDepartmentBudgetWorkbook,
  departmentExportFileName,
  departmentExportInfo,
  departmentExportLabel,
  parseDepartmentExportVersion,
  summaryExportFileName,
} from "@/features/smeta/lib/export-department-xlsx";
import {
  addExportInfoSheet,
  EXPORT_INFO_NOTE,
  EXPORT_INFO_SHEET_NAME,
  formatExportDateTime,
  type ExportInfo,
} from "@/features/smeta/lib/export-info-sheet";
import { workbookToBase64 } from "@/features/smeta/lib/export-plan-fact-xlsx";
import { freezeSheetFormulas } from "@/features/smeta/lib/version-snapshot";

const INFO: ExportInfo = {
  document: "Смета цеха «Звук»",
  project: "Проект",
  status: "на утверждении",
  version: "черновик (не утверждён)",
  approved: null,
  exportedBy: "Глава Звука",
  exportedAt: "03.11.2026 14:20",
};

/** Основной лист как в Univer: шапка, строка с формулой (значение сохранено в книге). */
function mainSheet() {
  return {
    id: "sheet-main",
    name: "Основной",
    cellData: {
      0: { 0: { v: "Наименование", t: 1, s: "b" }, 1: { v: "Итого", t: 1 } },
      1: { 0: { v: "Микрофон", t: 1 }, 1: { v: 1500, t: 2, f: "=C2*D2", s: "money" } },
      2: { 0: { v: "=HYPERLINK(\"x\")", t: 1 }, 1: { v: 2500, t: 2, f: "=СУММ(B2:B2)" } },
    },
    mergeData: [],
    columnData: { 0: { w: 210 } },
  };
}
const STYLES = { b: { bl: 1 }, money: { n: { pattern: "#,##0.00" } } };

/** Файл, как его получит человек: записать в xlsx и прочитать заново. */
async function roundTrip(workbook: ExcelJS.Workbook) {
  const back = new ExcelJS.Workbook();
  const buffer = Buffer.from(await workbookToBase64(workbook), "base64");
  await back.xlsx.load(buffer as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
  return back;
}

function allCells(sheet: ExcelJS.Worksheet) {
  const cells: ExcelJS.Cell[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => void cells.push(cell)),
  );
  return cells;
}

describe("Excel сметы цеха", () => {
  test("в файле только основной лист и «О выгрузке»; формул нет, значения на месте", async () => {
    const data = freezeSheetFormulas(mainSheet());
    const book = await roundTrip(buildDepartmentBudgetWorkbook({ name: "Основной", data, styles: STYLES }, INFO));
    assert.deepEqual(
      book.worksheets.map((s) => s.name),
      ["Основной", EXPORT_INFO_SHEET_NAME],
    );
    for (const sheet of book.worksheets) {
      for (const cell of allCells(sheet)) {
        assert.notEqual(cell.type, ExcelJS.ValueType.Formula, `${sheet.name}!${cell.address}`);
        assert.equal(cell.formula, undefined, `${sheet.name}!${cell.address}`);
      }
    }
    const main = book.getWorksheet("Основной")!;
    assert.equal(main.getCell("B2").value, 1500);
    assert.equal(main.getCell("B2").numFmt, "#,##0.00");
    assert.equal(main.getCell("A1").font?.bold, true);
    assert.equal(main.getCell("A3").value, "'=HYPERLINK(\"x\")", "текст, похожий на формулу, — с апострофом");
  });

  test("формула без заморозки тоже не попадает в файл — пишется сохранённое значение", async () => {
    const book = await roundTrip(
      buildDepartmentBudgetWorkbook({ name: "Основной", data: mainSheet(), styles: STYLES }, INFO),
    );
    const main = book.getWorksheet("Основной")!;
    assert.equal(main.getCell("B3").value, 2500);
    assert.equal(allCells(main).some((c) => c.type === ExcelJS.ValueType.Formula), false);
  });

  test("имя листа — годное для Excel", () => {
    const wb = buildDepartmentBudgetWorkbook({ name: "Смета: звук/свет [v2]", data: mainSheet(), styles: {} }, INFO);
    assert.equal(wb.worksheets[0]!.name, "Смета звук свет v2");
  });

  test("«О выгрузке»: документ, статус, версия, кто и когда; пустые строки пропускаются; сумм нет", async () => {
    const book = await roundTrip(
      buildDepartmentBudgetWorkbook({ name: "Основной", data: mainSheet(), styles: {} }, INFO),
    );
    const info = book.getWorksheet(EXPORT_INFO_SHEET_NAME)!;
    const text = allCells(info).map((c) => String(c.value));
    assert.deepEqual(text, [
      "Документ",
      "Смета цеха «Звук»",
      "Проект",
      "Проект",
      "Статус",
      "на утверждении",
      "Версия",
      "черновик (не утверждён)",
      "Выгрузил",
      "Глава Звука",
      "Когда",
      "03.11.2026 14:20",
      EXPORT_INFO_NOTE,
    ]);
    assert.equal(text.some((t) => /\d{3,}/.test(t.replace(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/, ""))), false);
  });

  test("цех назван «О выгрузке» — служебный лист получает другое имя", () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("О выгрузке");
    assert.equal(addExportInfoSheet(wb, INFO).name, "О выгрузке (PELENA)");
  });
});

describe("строки и имена", () => {
  const at = new Date("2026-11-03T11:20:00.000Z");

  test("«О выгрузке» для версии и для текущего листа", () => {
    const version = departmentExportInfo({
      projectName: "Проект",
      departmentName: "Звук",
      source: { kind: "version", number: 3 },
      approved: { at, byName: "Продюсер", byHead: true },
      exportedBy: "Глава",
      exportedAt: at,
      timezone: "Europe/Moscow",
    });
    assert.equal(version.status, "утверждена");
    assert.equal(version.version, "версия 3");
    assert.equal(version.approved, "03.11.2026 14:20, Продюсер (утвердил глава цеха)");
    assert.equal(version.exportedAt, "03.11.2026 14:20");
    const current = departmentExportInfo({
      projectName: "Проект",
      departmentName: "Звук",
      source: { kind: "current", status: "RETURNED" },
      approved: null,
      exportedBy: "Глава",
      exportedAt: at,
      timezone: "UTC",
    });
    assert.equal(current.status, "возвращена");
    assert.equal(current.approved, null);
    assert.equal(current.exportedAt, "03.11.2026 11:20");
  });

  test("метка в журнал и имя файла", () => {
    assert.equal(departmentExportLabel({ kind: "version", number: 3 }), "версия 3 (утверждена)");
    assert.equal(departmentExportLabel({ kind: "current", status: "SUBMITTED" }), "черновик (на утверждении)");
    assert.equal(
      departmentExportFileName("Звук", { kind: "version", number: 3 }, at, "Europe/Moscow"),
      "Смета · Звук · версия 3 (утверждена).xlsx",
    );
    assert.equal(
      departmentExportFileName("Звук", { kind: "current", status: "SUBMITTED" }, at, "Europe/Moscow"),
      "Смета · Звук · черновик (на утверждении) · 03.11.2026.xlsx",
    );
  });

  test("имя файла сводной — как на диске, дата по поясу проекта", () => {
    assert.equal(
      summaryExportFileName(false, at, "Europe/Moscow"),
      "Сводная смета · утверждённые версии · 03.11.2026.xlsx",
    );
    assert.equal(summaryExportFileName(true, at, "Europe/Moscow"), "Сводная смета · с черновиками · 03.11.2026.xlsx");
  });

  test("имя файла: недопустимые знаки убраны, имя не пустое", () => {
    assert.equal(
      departmentExportFileName('Звук/Свет: "А" <Б> | В? *', { kind: "version", number: 1 }, at, null),
      "Смета · Звук Свет А Б В · версия 1 (утверждена).xlsx",
    );
    assert.equal(
      departmentExportFileName("Цех\u0007\t2", { kind: "current", status: "DRAFT" }, at, null),
      "Смета · Цех 2 · черновик · 03.11.2026.xlsx",
    );
    assert.equal(
      departmentExportFileName("", { kind: "version", number: 2 }, at, null),
      "Смета · Цех · версия 2 (утверждена).xlsx",
    );
  });

  test("дата и время — по поясу проекта, 24 часа", () => {
    assert.equal(formatExportDateTime(new Date("2026-11-02T21:05:00.000Z"), "Europe/Moscow"), "03.11.2026 00:05");
  });

  test("из браузера — только номер версии", () => {
    assert.equal(parseDepartmentExportVersion(undefined), undefined);
    assert.equal(parseDepartmentExportVersion({}), undefined);
    assert.equal(parseDepartmentExportVersion({ version: undefined }), undefined);
    assert.equal(parseDepartmentExportVersion({ version: 2, departmentId: "x", projectId: "y" }), 2);
    for (const bad of ["2", [], { version: 0 }, { version: 1.5 }, { version: "2" }]) {
      assert.equal(parseDepartmentExportVersion(bad), false, JSON.stringify(bad));
    }
  });
});
