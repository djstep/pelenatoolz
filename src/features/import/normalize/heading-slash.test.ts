import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { classifyParagraphs } from "@/features/import/normalize/block-types";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import { parseHeading, parsePlace, usesLegacySlash } from "@/features/import/normalize/heading";
import { normalizeScript } from "@/features/import/normalize/normalize-script";
import { buildDocx, p } from "@/features/import/normalize/test-docx";

// «/» без пробелов в шапке (волна feat/sub-objects): то же, что « / »; в файлах старой записи
// с «///» — по-старому, «КВАРТИРА/СПАЛЬНЯ» = объект и подобъект (решение владельца: по файлу).

const pairs = (place: string, legacySlash = false) =>
  parsePlace(place, { legacySlash }).map((l) => [l.object, l.sub, l.separate]);

describe("«/» без пробелов — как « / »", () => {
  test("смежные подобъекты: «ДОМ. ДЕТСКАЯ/КОРИДОР» = «ДОМ. ДЕТСКАЯ / КОРИДОР»", () => {
    const expected = [
      ["ДОМ", "ДЕТСКАЯ", false],
      ["ДОМ", "КОРИДОР", false],
    ];
    assert.deepEqual(pairs("ДОМ. ДЕТСКАЯ/КОРИДОР"), expected);
    assert.deepEqual(pairs("ДОМ. ДЕТСКАЯ / КОРИДОР"), expected);
  });

  test("два объекта: «ДВОР ДОМА/ОПУШКА ЛЕСА» = «ДВОР ДОМА / ОПУШКА ЛЕСА»", () => {
    const expected = [
      ["ДВОР ДОМА", null, false],
      ["ОПУШКА ЛЕСА", null, true],
    ];
    assert.deepEqual(pairs("ДВОР ДОМА/ОПУШКА ЛЕСА"), expected);
    assert.deepEqual(pairs("ДВОР ДОМА / ОПУШКА ЛЕСА"), expected);
  });

  test("в полной шапке — то же", () => {
    const glued = parseHeading("13. ИНТ. ДОМ. ДЕТСКАЯ/КОРИДОР — НОЧЬ (04:40)");
    const spaced = parseHeading("13. ИНТ. ДОМ. ДЕТСКАЯ / КОРИДОР — НОЧЬ (04:40)");
    assert.deepEqual(glued.locations, spaced.locations);
    assert.equal(glued.time, "НОЧЬ");
    assert.equal(glued.fileSeconds, 280);
  });

  test("«/» между цифрами не делит", () => {
    assert.deepEqual(pairs("КВ. 1/2"), [["КВ. 1/2", null, false]]);
  });
});

describe("старая запись с «///» — по-старому", () => {
  test("«КВАРТИРА/СПАЛЬНЯ///КОРИДОР» — объект КВАРТИРА и два подобъекта", () => {
    assert.deepEqual(pairs("КВАРТИРА/СПАЛЬНЯ///КОРИДОР", true), [
      ["КВАРТИРА", "СПАЛЬНЯ", false],
      ["КВАРТИРА", "КОРИДОР", false],
    ]);
  });

  test("режим выбирается по файлу: есть «///» хоть в одной строке", () => {
    assert.equal(usesLegacySlash(["1. ИНТ. КВАРТИРА/СПАЛЬНЯ///КОРИДОР — ДЕНЬ", "Текст"]), true);
    assert.equal(usesLegacySlash(["13. ИНТ. ДОМ. ДЕТСКАЯ/КОРИДОР — НОЧЬ", "https://example.ru"]), false);
  });
});

describe("импорт файла: «/» без пробелов", () => {
  const run = (...headings: string[]) =>
    normalizeScript(
      classifyParagraphs(
        readDocxParagraphs(buildDocx({ body: headings.flatMap((h) => [p(h, "Heading 1"), p("Текст.")]).join("") })),
      ),
      {},
      { existing: { characters: [], locations: [], scenes: [] } },
    );
  const placesOf = (result: ReturnType<typeof run>, index: number) =>
    result.scenes[index]!.locations.map((l) => (l.sub ? `${l.object} › ${l.sub}` : l.object));

  test("новый файл: «ДЕТСКАЯ/КОРИДОР» — два подобъекта ДОМа", () => {
    const result = run("13. ИНТ. ДОМ. ДЕТСКАЯ/КОРИДОР — НОЧЬ", "16. ИНТ. ДОМ. ДЕТСКАЯ / КУХНЯ — НОЧЬ");
    assert.deepEqual(placesOf(result, 0), ["ДОМ › ДЕТСКАЯ", "ДОМ › КОРИДОР"]);
    assert.deepEqual(placesOf(result, 1), ["ДОМ › ДЕТСКАЯ", "ДОМ › КУХНЯ"]);
  });

  test("файл старой записи: «КВАРТИРА/ДЕТСКАЯ» — объект и подобъект", () => {
    const result = run("1. ИНТ. КВАРТИРА/СПАЛЬНЯ///КОРИДОР — ДЕНЬ", "9. ИНТ. КВАРТИРА/ДЕТСКАЯ — ВЕЧЕР");
    assert.deepEqual(placesOf(result, 0), ["КВАРТИРА › СПАЛЬНЯ", "КВАРТИРА › КОРИДОР"]);
    assert.deepEqual(placesOf(result, 1), ["КВАРТИРА › ДЕТСКАЯ"]);
  });
});
