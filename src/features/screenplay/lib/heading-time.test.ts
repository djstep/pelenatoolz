import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import {
  buildScreenplayDocx,
  buildScreenplayFountain,
  buildScreenplayPrintHtml,
} from "@/features/screenplay/lib/export-screenplay";
import { buildSlugline, keepHeadingTime, parseSlugline } from "@/features/screenplay/lib/slugline";

describe("хронометраж в шапке сценария", () => {
  test("разбор в редакторе: режим распознан, локация без хвоста", () => {
    for (const [text, location, dayNight] of [
      ["1. НАТ. ЗАГОРОДНЫЙ ДОМ — РАССВЕТ (00:15)", "ЗАГОРОДНЫЙ ДОМ", "DAWN"],
      ["2. ИНТ. ДОМ — ДЕНЬ (1:02:05)", "ДОМ", "DAY"],
      ["3. ИНТ. ДОМ — НОЧЬ", "ДОМ", "NIGHT"],
    ] as const) {
      const parsed = parseSlugline(text);
      assert.equal(parsed?.location, location, text);
      assert.equal(parsed?.dayNight, dayNight, text);
    }
  });

  test("правка сцены в либретто сохраняет время в шапке и не удваивает его", () => {
    const rebuilt = buildSlugline({ episodeNumber: 0, number: "1", postfix: "", intExt: "EXT", dayNight: "DAWN", location: "ДОМ" });
    const once = keepHeadingTime(rebuilt, "1. НАТ. ЗАГОРОДНЫЙ ДОМ — РАССВЕТ (00:15)");
    assert.equal(once, `${rebuilt} (00:15)`);
    assert.equal(keepHeadingTime(rebuilt, once), once);
    assert.equal(once.match(/\(00:15\)/g)?.length, 1);
  });

  test("время перед пометкой тоже сохраняется", () => {
    assert.equal(keepHeadingTime("1. ИНТ. ДОМ", "1. ИНТ. ДОМ — ДЕНЬ (00:15) (ПОЗЖЕ)"), "1. ИНТ. ДОМ (00:15)");
  });

  test("шапка без времени остаётся без времени", () => {
    assert.equal(keepHeadingTime("1. ИНТ. ДОМ", "1. ИНТ. ДОМ — ДЕНЬ (ПОЗЖЕ)"), "1. ИНТ. ДОМ");
  });

  describe("экспорт печатает шапку со временем", () => {
    const heading = "1. НАТ. ЗАГОРОДНЫЙ ДОМ — РАССВЕТ (00:15)";
    const blocks = [
      { type: "SLUGLINE" as const, content: heading },
      { type: "ACTION" as const, content: "Текст сцены." },
    ];

    test("Fountain", () => {
      assert.ok(buildScreenplayFountain(blocks).startsWith(`${heading}\n`));
    });

    test("PDF: страница для печати", () => {
      assert.ok(buildScreenplayPrintHtml(blocks, "Сценарий").includes(heading));
    });

    test("DOCX", async () => {
      const paragraphs = readDocxParagraphs(await buildScreenplayDocx(blocks));
      assert.ok(paragraphs.some((p) => p.text === heading));
    });
  });
});
