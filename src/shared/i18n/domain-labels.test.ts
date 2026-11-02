import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";
import { buildCallSheetPrintModel } from "@/features/call-sheets/print/print-model";
import { buildCallSheetWorkbook } from "@/features/call-sheets/print/print-xlsx";
import { IRP_DAY_SOURCE } from "@/features/call-sheets/print/preview-fixtures";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";

describe("хронометраж «М:СС» — одна функция для всей системы", () => {
  test("0, 59, 60, 605 секунд, пустое значение", () => {
    assert.equal(formatSecondsMmSs(0), "—");
    assert.equal(formatSecondsMmSs(59), "0:59");
    assert.equal(formatSecondsMmSs(60), "1:00");
    assert.equal(formatSecondsMmSs(605), "10:05");
    assert.equal(formatSecondsMmSs(null), "—");
    assert.equal(formatSecondsMmSs(undefined), "—");
  });

  test("минуты без нуля впереди и без часов, секунды двумя цифрами; дробное — округляется", () => {
    assert.equal(formatSecondsMmSs(23), "0:23");
    assert.equal(formatSecondsMmSs(725), "12:05");
    assert.equal(formatSecondsMmSs(3725), "62:05");
    assert.equal(formatSecondsMmSs(59.6), "1:00");
    assert.equal(formatSecondsMmSs(-5), "—");
    assert.equal(formatSecondsMmSs(Number.NaN), "—");
  });

  test("вызывной: печать и Excel (из него же Google Таблица) — тем же форматом, без штрихов", () => {
    const model = buildCallSheetPrintModel(IRP_DAY_SOURCE);
    assert.equal(model.totals.dayTiming, formatSecondsMmSs(37));
    const page = buildCallSheetHtml(model);
    assert.ok(page.includes(">0:37<"));
    assert.doesNotMatch(page, /[′″]/);
    const cells: string[] = [];
    buildCallSheetWorkbook(model).worksheets[0]!.eachRow((row) =>
      row.eachCell((cell) => {
        if (typeof cell.value === "string") cells.push(cell.value);
      }),
    );
    assert.ok(cells.includes("0:37"), "итог юнита");
    assert.ok(cells.includes("0:10"), "строка сцены");
    assert.ok(!cells.some((v) => /[′″]/.test(v)));
  });

  test("КПП, вызывной на экране, печать, Excel — хрон считают через formatSecondsMmSs, своих форматтеров нет", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    for (const file of [
      "src/features/schedule/lib/day-summary.ts",
      "src/features/schedule/lib/kpp-export-cells.ts",
      "src/features/day-docs/lib/build-day-doc.ts",
      "src/features/call-sheets/print/print-model.ts",
    ]) {
      const source = read(file);
      assert.ok(source.includes("formatSecondsMmSs("), `${file} — через общую функцию`);
      assert.doesNotMatch(source, /[′″]/, `${file} — без штрихов`);
    }
    // Лист и книга вызывного свой хрон не форматируют — берут готовую строку из модели.
    for (const file of ["src/features/call-sheets/print/print-html.ts", "src/features/call-sheets/print/print-xlsx.ts"]) {
      const source = read(file);
      assert.ok(!/planSeconds|formatTiming|% 60/.test(source), `${file} — хрон только из модели`);
    }
  });
});
