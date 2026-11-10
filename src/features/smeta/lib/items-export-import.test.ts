import assert from "node:assert/strict";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import { buildItemsSnapshot, type SnapshotSourceArticle } from "@/features/smeta/lib/items-snapshot";
import { addItemsSheet, smetaDefaultExportColumns, smetaExportColumns } from "@/features/smeta/lib/items-export-xlsx";
import { guessHeaderRow, guessMapping, mappedRows, parseMultipliersText } from "@/features/smeta/lib/items-import";

const vars = [{ id: "smeny", key: "SMENY", label: "СМЕНЫ", value: "10" }];
const articles: SnapshotSourceArticle[] = [
  {
    id: "a1",
    code: "TR-05",
    templateArticleId: "t1",
    name: "Транспорт",
    subarticles: [
      {
        id: "s1",
        code: "TR-05.01",
        name: "Спецтранспорт",
        items: [
          {
            id: "i1",
            code: "TR-05.01.03",
            name: "Камерваген",
            unit: "смена",
            quantity: "1",
            rate: "15000",
            taxPercent: "6",
            expenseType: "Транспорт",
            paymentForm: "ИП",
            multiplier1VariableId: "smeny",
            multiplier1Value: null,
            multiplier2VariableId: null,
            multiplier2Value: "0.7",
            multiplier3VariableId: null,
            multiplier3Value: null,
          },
        ],
      },
    ],
  },
];

async function sheetRows(columns = smetaDefaultExportColumns()) {
  const workbook = new ExcelJS.Workbook();
  addItemsSheet(workbook, "Смета", buildItemsSnapshot(articles, vars), columns);
  // Через файл — как у пользователя.
  const reread = new ExcelJS.Workbook();
  await reread.xlsx.load((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
  const sheet = reread.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe("Excel сметы по статьям", () => {
  test("уровни, коды, множители, налог и итоги", async () => {
    const rows = await sheetRows();
    assert.deepEqual(rows[0], ["Код", "Наименование", "Тип", "Ед.", "Кол-во", "Ставка", "Множители", "Форма оплаты", "Налог, %", "Сумма", "Налог", "Итого"]);
    assert.equal(rows[1][0], "TR-05");
    assert.equal(rows[1][1], "Транспорт");
    assert.equal(rows[1][11], 111300);
    assert.equal(rows[2][0], "TR-05.01");
    assert.deepEqual(rows[3], ["TR-05.01.03", "Камерваген", "Транспорт", "смена", 1, 15000, "× СМЕНЫ (10) × 0,7", "ИП", 6, 105000, 6300, 111300]);
    assert.equal(rows[4][1], "Итого по смете");
    assert.equal(rows[4][11], 111300);
  });

  test("конструктор колонок: «Код» можно убрать, неизвестные поля — выбрасываются", async () => {
    const columns = smetaExportColumns([
      { id: "c1", title: "Позиция", fieldIds: ["name", "unit"] },
      { id: "c2", title: "Итого", fieldIds: ["total", "hacker"] },
      { id: "c3", title: "Пусто", fieldIds: ["nope"] },
    ]);
    assert.deepEqual(columns.map((c) => c.fieldIds), [["name", "unit"], ["total"]]);
    const rows = await sheetRows(columns);
    assert.deepEqual(rows[0], ["Позиция", "Итого"]);
    assert.deepEqual(rows[3], ["Камерваген · смена", 111300]);
    assert.deepEqual(smetaExportColumns("мусор"), smetaDefaultExportColumns());
  });
});

describe("импорт из Excel в статьи", () => {
  test("наша выгрузка читается обратно: заголовки, колонки, строки статей и «Итого» пропускаются", async () => {
    const rows = (await sheetRows()).map((r) => r.map((c) => (c == null ? "" : String(c))));
    const h = guessHeaderRow(rows);
    assert.equal(h, 0);
    const mapping = guessMapping(rows[h]);
    assert.equal(mapping.code, 0);
    assert.equal(mapping.name, 1);
    assert.equal(mapping.multipliers, 6);
    assert.equal(mapping.taxPercent, 8);
    const lines = mappedRows(rows, h, mapping);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].row, 4);
    assert.equal(lines[0].values.code, "TR-05.01.03");
    assert.equal(lines[0].values.rate, "15000");
  });

  test("чужой лист: заголовок не в первой строке, пустые строки пропускаются", () => {
    const rows = [["Смета на съёмки"], [], ["Название", "Цена", "Количество"], ["Рация", "500", "4"], [], ["Генератор", "3000,5", "1"]];
    const h = guessHeaderRow(rows);
    assert.equal(h, 2);
    const lines = mappedRows(rows, h, guessMapping(rows[h]));
    assert.deepEqual(
      lines.map((l) => [l.row, l.values.name, l.values.rate, l.values.quantity]),
      [
        [4, "Рация", "500", "4"],
        [6, "Генератор", "3000,5", "1"],
      ],
    );
  });

  test("множители текстом: переменная по названию, число, не больше трёх, неизвестное — ошибка", () => {
    const v = [{ id: "smeny", label: "СМЕНЫ" }, { id: "tech", label: "Тех. смены" }];
    assert.deepEqual(parseMultipliersText("× СМЕНЫ (32) × 0,7", v), { ok: true, value: [{ variableId: "smeny" }, { value: "0.7" }, null] });
    assert.deepEqual(parseMultipliersText("тех. смены", v), { ok: true, value: [{ variableId: "tech" }, null, null] });
    assert.deepEqual(parseMultipliersText("", v), { ok: true, value: [null, null, null] });
    assert.equal(parseMultipliersText("× 1 × 2 × 3 × 4", v).ok, false);
    const bad = parseMultipliersText("× НЕДЕЛИ", v);
    assert.ok(!bad.ok && bad.error.includes("НЕДЕЛИ"));
  });
});
