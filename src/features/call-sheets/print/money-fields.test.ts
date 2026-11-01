import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { ACTOR_FIELDS, CHARACTER_FIELDS } from "@/features/characters/lib/character-fields";
import { LOCATION_FIELDS, SCOUT_SNAPSHOT_FIELDS } from "@/features/locations/lib/location-fields";
import { buildCallSheetHtml } from "@/features/call-sheets/print/print-html";
import {
  buildCallSheetPrintModel,
  type CallSheetPrintSource,
} from "@/features/call-sheets/print/print-model";
import { FULL_DAY_SOURCE, IRP_DAY_SOURCE } from "@/features/call-sheets/print/preview-fixtures";
import { parseSnapshotModel } from "@/features/call-sheets/print/print-source";
import { buildCallSheetWorkbook } from "@/features/call-sheets/print/print-xlsx";
import { RESOURCE_ITEM_FIELDS } from "@/features/resources/lib/item-fields";

/**
 * Слияние с волной 2в: в модели листа (и снимке утверждения — это та же модель JSON), в HTML
 * и в Excel нет денежных полей — ставок актёров, объектов, ресурсов, км спецтранспорта.
 */

const MONEY_KEYS = [
  ...ACTOR_FIELDS.finance,
  ...CHARACTER_FIELDS.finance,
  ...LOCATION_FIELDS.finance,
  ...RESOURCE_ITEM_FIELDS.finance,
  ...SCOUT_SNAPSHOT_FIELDS.finance,
  "kmRate",
  "budgetItemId",
  "unitPrice",
] as const;

/** Каждому объекту источника — денежные поля с метками «917…»: будто их выбрали из базы. */
function poison(source: CallSheetPrintSource): CallSheetPrintSource {
  const copy = structuredClone(source);
  let n = 0;
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object" || value instanceof Date) return;
    const row = value as Record<string, unknown>;
    for (const key of Object.keys(row)) walk(row[key]);
    for (const key of MONEY_KEYS) {
      if (!(key in row)) row[key] = `917${String(++n).padStart(4, "0")}`;
    }
  };
  walk(copy);
  return copy;
}

function cellsOf(model: ReturnType<typeof buildCallSheetPrintModel>) {
  const values: string[] = [];
  buildCallSheetWorkbook(model, { status: "DRAFT", version: 1 })
    .worksheets[0]!.eachRow((row) => row.eachCell((cell) => values.push(String(cell.value))));
  return values.join("\n");
}

describe("денежных полей нет в листе вызывного", () => {
  for (const [name, source] of [
    ["ИРП", IRP_DAY_SOURCE],
    ["насыщенный день", FULL_DAY_SOURCE],
  ] as const) {
    test(`${name}: модель, снимок, HTML и Excel — без ставок, даже если их выбрали из базы`, () => {
      const model = buildCallSheetPrintModel(poison(source));
      const json = JSON.stringify(model);
      const snapshot = JSON.stringify(parseSnapshotModel(JSON.parse(json)));
      const html = buildCallSheetHtml(model, {
        stamp: { status: "APPROVED", version: 1, approvedAtLabel: "10.09, 17:46" },
      });
      const xlsx = cellsOf(model);
      for (const [where, text] of [
        ["модель", json],
        ["снимок", snapshot],
        ["HTML", html],
        ["Excel", xlsx],
      ] as const) {
        assert.doesNotMatch(text, /917\d{4}/, `${where}: значение денежного поля`);
      }
      for (const key of MONEY_KEYS) {
        assert.ok(!json.includes(`"${key}":`), `модель: поле ${key}`);
      }
    });
  }
});

describe("выборки дня для листа — только открытыми полями", () => {
  const read = (file: string) =>
    readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

  test("день КПП (`getShootDayDocument`): объекты, персонажи, актёры, ресурсы, спецтранспорт — списками полей", () => {
    const queries = read("src/features/day-docs/queries.ts");
    for (const select of [
      "location: { select: SCENE_LOCATION_SELECT }",
      "character: { select: SCENE_CHARACTER_SELECT }",
      "...SCENE_RESOURCE_ITEM_SELECT",
      "select: { ...SCENE_ACTOR_SELECT",
      "resources: { select: SCENE_RESOURCE_SELECT }",
      "transports: { select: DAY_TRANSPORT_SELECT",
    ]) {
      assert.ok(queries.includes(select), select);
    }
    assert.doesNotMatch(
      queries,
      /\b(location|character|actor|item|resources|transports|actorCalls\.actor)\s*:\s*true/,
      "целых записей нет",
    );
    const transport = queries.slice(queries.indexOf("const DAY_TRANSPORT_SELECT"));
    const list = transport.slice(0, transport.indexOf("]);"));
    assert.ok(!list.includes("kmRate") && !list.includes("budgetItemId"), "без ставки км и статьи");
  });

  test("объект схемы вызывного — открытыми полями объекта", () => {
    const queries = read("src/features/call-sheets/queries.ts");
    assert.ok(queries.includes("...CALL_SHEET_SCHEME_LOCATION_SELECT"));
    const fields = read("src/features/locations/lib/location-fields.ts");
    assert.match(
      fields,
      /CALL_SHEET_SCHEME_LOCATION_KEYS = \[[\s\S]*?\] as const satisfies readonly \(typeof LOCATION_FIELDS\.open\)\[number\]\[\];/,
    );
    for (const key of LOCATION_FIELDS.finance) {
      assert.ok(!(LOCATION_FIELDS.open as readonly string[]).includes(key), key);
    }
  });
});
