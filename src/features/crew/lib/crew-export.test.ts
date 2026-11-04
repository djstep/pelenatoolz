import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  crewDefaultExportColumns,
  crewExportCell,
  crewExportColumns,
  crewExportFields,
  crewExportGroups,
  crewPrintColumns,
} from "@/features/crew/lib/crew-export";
import { buildCrewPrintHtml } from "@/features/crew/lib/crew-export-print";
import { buildCrewWorkbook } from "@/features/crew/lib/crew-export-xlsx";
import { toCrewRow, type CrewRecord, type CrewRights } from "@/features/crew/lib/crew-rules";
import { exportLayoutPermission, exportLayoutSavePermissions } from "@/features/exports/lib/column-utils";
import type { ExportColumn } from "@/features/exports/types";
import { PRINT_HTML_CSP_META } from "@/shared/lib/escape-html";

const FULL: CrewRights = { write: true, contacts: true, contracts: true };
const NONE: CrewRights = { write: false, contacts: false, contracts: false };
const PHONE = "+7 900 111-22-33";
const EMAIL = "svetov@e2e.test";
const NUMBER = "E2E-К1";

function record(overrides: Partial<CrewRecord> = {}): CrewRecord {
  return {
    id: "m1",
    lastName: "Светов",
    firstName: "Игорь",
    middleName: "Павлович",
    position: "Осветитель",
    departmentId: "d1",
    department: { name: "Свет" },
    note: null,
    sortOrder: 0,
    source: "CONTRACT",
    archivedAt: null,
    phone: PHONE,
    email: EMAIL,
    contractLinks: [
      {
        contract: {
          id: "c1",
          number: NUMBER,
          date: new Date("2026-10-01T12:00:00Z"),
          status: { key: "SIGNED", name: "Подписан", color: "#000000" },
        },
      },
    ],
    ...overrides,
  };
}

const departments = [{ id: "d1", name: "Свет" }];

function columnsOf(...fieldIds: string[]): ExportColumn[] {
  return fieldIds.map((id) => ({ id, title: id, fieldIds: [id] }));
}

const ALL_FIELDS = columnsOf(
  "department",
  "fullName",
  "position",
  "phone",
  "email",
  "source",
  "contractNumber",
  "contractDate",
  "contractStatus",
  "note",
);

describe("колонки по правам", () => {
  test("конструктор предлагает только разрешённые поля", () => {
    const ids = (rights: CrewRights) => crewExportFields(rights).map((f) => f.id);
    assert.deepEqual(ids(NONE), ["department", "fullName", "position", "source", "note"]);
    assert.ok(ids({ ...NONE, contacts: true }).includes("phone"));
    assert.ok(!ids({ ...NONE, contacts: true }).includes("contractNumber"));
    assert.ok(ids({ ...NONE, contracts: true }).includes("contractNumber"));
    assert.ok(!ids({ ...NONE, contracts: true }).includes("email"));
    assert.equal(ids(FULL).length, ALL_FIELDS.length);
  });

  test("сумм нет ни у кого", () => {
    assert.ok(!crewExportFields(FULL).some((f) => /amount|sum|сумм/i.test(`${f.id} ${f.label}`)));
  });

  test("поля по умолчанию — разрешённые, у каждого своя колонка", () => {
    assert.deepEqual(
      crewDefaultExportColumns(NONE).map((c) => c.title),
      ["Цех", "ФИО", "Должность", "Источник", "Заметка"],
    );
  });

  test("подделанный запрос: поля без права и неизвестные поля выброшены", () => {
    const forged = [
      ...ALL_FIELDS,
      { id: "x", title: "Сумма", fieldIds: ["amountWithVat", "syncedValues"] },
      { id: "y", title: "Вместе", fieldIds: ["fullName", "phone"] },
    ];
    const result = crewExportColumns(forged, NONE);
    assert.deepEqual(
      result.map((c) => c.id),
      ["department", "fullName", "position", "source", "note", "y"],
    );
    assert.deepEqual(result.at(-1)?.fieldIds, ["fullName"]);
  });

  test("признак сборной колонки ресурсов в команде не живёт", () => {
    const [column] = crewExportColumns([{ id: "a", title: "ФИО", fieldIds: ["fullName"], isExtrasBucket: true }], FULL);
    assert.equal(column?.isExtrasBucket, undefined);
  });

  test("раскладку сохраняет только тот, кому доступны все колонки", () => {
    assert.deepEqual(exportLayoutSavePermissions("crew"), ["crew:write", "crew:contacts", "contracts:read"]);
    assert.equal(exportLayoutPermission("crew", "read"), "crew:read");
    assert.deepEqual(exportLayoutSavePermissions("libretto"), ["script:write"]);
  });
});

describe("значения", () => {
  test("права: без них телефона, почты и договора в файле нет, даже если колонка дошла", () => {
    const row = toCrewRow(record(), NONE);
    for (const column of columnsOf("phone", "email", "contractNumber", "contractDate", "contractStatus")) {
      assert.equal(crewExportCell(row, column), "");
    }
  });

  test("с правами — всё, несколько договоров через «;» в одном порядке", () => {
    const base = record();
    const row = toCrewRow(
      record({
        contractLinks: [
          ...base.contractLinks!,
          {
            contract: {
              id: "c2",
              number: "E2E-К9",
              date: new Date("2026-11-01T12:00:00Z"),
              status: { key: "REJECTED", name: "Отклонён", color: "#000000" },
            },
          },
        ],
      }),
      FULL,
    );
    const [number, status, phone] = columnsOf("contractNumber", "contractStatus", "phone").map((c) =>
      crewExportCell(row, c),
    );
    assert.equal(number, `E2E-К9; ${NUMBER}`);
    assert.equal(status, "Отклонён; Подписан");
    assert.equal(phone, PHONE);
  });

  test("составная колонка, пустое значение пропускается", () => {
    const row = toCrewRow(record({ position: null }), FULL);
    assert.equal(
      crewExportCell(row, { id: "a", title: "А", fieldIds: ["fullName", "position", "phone"] }),
      `Светов Игорь Павлович · ${PHONE}`,
    );
  });

  test("договор удалён, без права на договоры — только источник", () => {
    const deleted = record({ contractLinks: [] });
    const [status] = columnsOf("contractStatus");
    assert.equal(crewExportCell(toCrewRow(deleted, FULL), status!), "договор удалён");
    assert.equal(crewExportCell(toCrewRow(deleted, NONE), status!), "");
    const [source] = columnsOf("source");
    assert.equal(crewExportCell(toCrewRow(deleted, NONE), source!), "из договора");
  });
});

describe("группы и архив", () => {
  const active = toCrewRow(record(), FULL);
  const archived = toCrewRow(
    record({ id: "m2", lastName: "Ушедший", archivedAt: new Date("2026-10-10T00:00:00Z") }),
    FULL,
  );

  test("архив не попадает, пока не попросили", () => {
    assert.deepEqual(
      crewExportGroups([active, archived], departments, false).map((g) => [g.title, g.rows.length]),
      [["Свет", 1]],
    );
  });

  test("по запросу — отдельной группой в конце, в цехе пометка", () => {
    const groups = crewExportGroups([active, archived], departments, true);
    assert.deepEqual(
      groups.map((g) => g.title),
      ["Свет", "Архив"],
    );
    assert.equal(crewExportCell(groups[1]!.rows[0]!, columnsOf("department")[0]!), "Свет (архив)");
  });

  test("архива нет — пустой группы нет", () => {
    assert.equal(crewExportGroups([active], departments, true).length, 1);
  });

  test("только архивные — без запроса пусто", () => {
    assert.deepEqual(crewExportGroups([archived], departments, false), []);
  });
});

describe("печать", () => {
  const groups = crewExportGroups([toCrewRow(record(), FULL)], departments, false);

  test("Medeo Sans встроен, скриптов нет, CSP первой строкой, поля без колонтитулов", () => {
    const html = buildCrewPrintHtml("Проект", ALL_FIELDS, groups);
    assert.ok(html.includes(`<head>${PRINT_HTML_CSP_META}`));
    assert.ok(html.includes('font-family:"Medeo Sans"'));
    assert.ok(html.includes("data:font/woff2;base64,"));
    assert.ok(html.includes('"Medeo Sans",Arial'));
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /@(top|bottom)-(left|center|right)|counter\(page|counter\(pages/);
  });

  test("цех — заголовок группы, а не колонка; белый лист в обеих темах", () => {
    const html = buildCrewPrintHtml("Проект", ALL_FIELDS, groups);
    assert.match(html, /<tr class="group"><th colspan="9" scope="rowgroup">Свет<span>1<\/span>/);
    assert.ok(!html.includes(">department</th>"));
    assert.ok(html.includes("color-scheme:light"));
    assert.ok(html.includes("background:#fff"));
    assert.doesNotMatch(html, /prefers-color-scheme/);
  });

  test("книжный лист до 5 колонок, дальше альбомный", () => {
    assert.match(buildCrewPrintHtml("П", columnsOf("fullName", "position"), groups), /size:A4;/);
    assert.match(buildCrewPrintHtml("П", ALL_FIELDS, groups), /size:A4 landscape;/);
  });

  test("слова не рвутся: телефон в одну строку, разрывать можно только почту", () => {
    const html = buildCrewPrintHtml("П", columnsOf("fullName", "phone", "email"), groups);
    assert.ok(html.includes(`<td class="nowrap">${PHONE}</td>`));
    assert.ok(html.includes(`<td class="long">${EMAIL}</td>`));
    assert.ok(html.includes("<td>Светов Игорь Павлович</td>"));
    assert.match(html, /th,td\{[^}]*overflow-wrap:break-word/);
  });

  test("единственная колонка «Цех» остаётся: печатать без колонок нельзя", () => {
    const only = columnsOf("department");
    assert.deepEqual(crewPrintColumns(only), only);
  });

  test("составная колонка теряет только цех", () => {
    assert.deepEqual(
      crewPrintColumns([{ id: "a", title: "А", fieldIds: ["department", "fullName"] }])[0]?.fieldIds,
      ["fullName"],
    );
  });

  test("текст экранируется: имя, проект, заголовок колонки", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const html = buildCrewPrintHtml(
      evil,
      [{ id: "a", title: evil, fieldIds: ["fullName"] }],
      crewExportGroups([toCrewRow(record({ lastName: evil }), FULL)], departments, false),
    );
    assert.ok(!html.includes(evil));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });

  test("без прав данных нет и в HTML", () => {
    const html = buildCrewPrintHtml("Проект", ALL_FIELDS, crewExportGroups([toCrewRow(record(), NONE)], departments, false));
    for (const secret of [PHONE, EMAIL, NUMBER, "Подписан"]) assert.ok(!html.includes(secret));
  });
});

describe("Excel", () => {
  async function sheetValues(columns: ExportColumn[], rights: CrewRights, overrides: Partial<CrewRecord> = {}) {
    const ExcelJS = (await import("exceljs")).default;
    const buffer = await buildCrewWorkbook(
      columns,
      crewExportGroups([toCrewRow(record(overrides), rights)], departments, false),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Команда");
    assert.ok(sheet);
    return {
      header: sheet.getRow(1).values as unknown[],
      row: sheet.getRow(2).values as unknown[],
      sheet,
    };
  }

  test("заголовки из колонок, телефон остаётся текстом", async () => {
    const { header, row } = await sheetValues(
      [
        { id: "a", title: "Имя в файле", fieldIds: ["fullName"] },
        { id: "b", title: "Телефон", fieldIds: ["phone"] },
      ],
      FULL,
    );
    assert.deepEqual(header.slice(1), ["Имя в файле", "Телефон"]);
    assert.deepEqual(row.slice(1), ["Светов Игорь Павлович", PHONE]);
  });

  test("значение и заголовок, похожие на формулу, не становятся формулой", async () => {
    const { header, row } = await sheetValues(
      [{ id: "a", title: "=1+1", fieldIds: ["note"] }],
      FULL,
      { note: '=HYPERLINK("http://evil","x")' },
    );
    assert.equal(header[1], "'=1+1");
    assert.equal(row[1], `'=HYPERLINK("http://evil","x")`);
  });
});
