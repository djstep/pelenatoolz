import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  classifyParagraphs,
  type BlockTypingResult,
  type ImportBlockType,
} from "@/features/import/normalize/block-types";
import {
  parseDocxParagraphs,
  readDocxParagraphs,
  type DocxParagraph,
} from "@/features/import/normalize/docx-paragraphs";
import { DOCX_LIMITS, DocxReadError } from "@/features/import/normalize/docx-zip";
import { buildDocx, buildZip, p } from "@/features/import/normalize/test-docx";

// Ожидания — утверждённая таблица в docs/tasks/WAVE_4_NOTES.md (коды D*, R*, V*).

const FIXTURES = path.join(process.cwd(), "docs", "tasks", "fixtures", "scripts");

function fixtureParagraphs(name: string) {
  return readDocxParagraphs(readFileSync(path.join(FIXTURES, name)));
}

function classifyFixture(name: string): BlockTypingResult {
  return classifyParagraphs(fixtureParagraphs(name));
}

function texts(result: BlockTypingResult, type: ImportBlockType) {
  return result.blocks.filter((b) => b.type === type).map((b) => b.text.trim());
}

/** Имя из реплики без расширений в скобках, верхний регистр. */
function cueNames(result: BlockTypingResult) {
  return new Set(
    texts(result, "CHARACTER").map((t) =>
      t.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toUpperCase(),
    ),
  );
}

const CM = 567;

describe("ddct.docx — английские стили", () => {
  const result = classifyFixture("ddct.docx");

  test("все типы определены по стилям, расхождений нет", () => {
    assert.ok(result.blocks.every((b) => b.level === "style"));
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.indentProfile, null);
  });

  test("D1: шапки 1–36 и «37.»; две пустые шапки выброшены", () => {
    const sluglines = texts(result, "SLUGLINE");
    assert.equal(sluglines.length, 37);
    sluglines.slice(0, 36).forEach((t, i) => assert.ok(t.startsWith(`${i + 1}. `), t));
    assert.equal(sluglines[36], "37.");
    assert.equal(result.dropped.filter((d) => d.type === "SLUGLINE").length, 2);
  });

  test("D2: «1. ЗАКАДРОВЫЙ ГОЛОС» — шапка по стилю (вопрос задаёт нормализация)", () => {
    assert.equal(texts(result, "SLUGLINE")[0], "1. ЗАКАДРОВЫЙ ГОЛОС");
    assert.equal(result.blocks.filter((b) => b.beforeFirstScene).length, 0);
  });

  test("D9, D10: имена в репликах — только ожидаемые; 11 пустых имён выброшены", () => {
    const expected = new Set([
      "АДМИНИСТРАТОР-ПОМОЩНИК",
      "ВИКТОРИЯ",
      "СТАЖЕР",
      "МАРИЯ",
      "НАЧАЛЬНИК",
      "ЮРИЙ",
      "СОТРУДНИК",
      "МАКСИМ",
      "АДМИНИСТРАТОР",
      "ВАЛЕРИЯ",
      "НИКОЛАЙ",
      "СТАЖЕР1",
      "", // «(ДАЛЬШЕ)»
    ]);
    assert.deepEqual(cueNames(result), expected);
    assert.ok(texts(result, "CHARACTER").includes("(ДАЛЬШЕ)"));
    assert.ok(texts(result, "CHARACTER").includes("МАКСИМ (ПРОД.)"));
    assert.equal(result.dropped.filter((d) => d.type === "CHARACTER").length, 11);
  });

  test("D12: переходы CUT TO:, FADE TO BLACK", () => {
    assert.deepEqual(texts(result, "TRANSITION"), ["CUT TO:", "FADE TO BLACK"]);
  });

  test("ремарки — только абзацы стиля PARENTHETICAL, каждая в скобках", () => {
    const parentheticals = result.blocks.filter((b) => b.type === "PARENTHETICAL");
    assert.ok(parentheticals.length > 0);
    for (const block of parentheticals) {
      assert.equal(block.styleName, "PARENTHETICAL");
      assert.match(block.text.trim(), /^\(.*\)$/);
    }
  });

  test("номера сцен набраны текстом, автонумерации нет ни в одном абзаце", () => {
    assert.ok(fixtureParagraphs("ddct.docx").every((x) => x.autoNumber === null));
    assert.deepEqual(result.notices, []);
  });
});

describe("moya-malenkaya-draft.docx — без стилей, по отступам", () => {
  const result = classifyFixture("moya-malenkaya-draft.docx");

  test("R1: до первой шапки — только строки титульной", () => {
    const before = result.blocks.filter((b) => b.beforeFirstScene).map((b) => b.text.trim());
    assert.deepEqual(before, [
      "МОЯ МАЛЕНЬКАЯ",
      "Первый драфт режиссерской версии",
      "22.10.2026",
    ]);
  });

  test("R2: 16 шапок, включая 11А", () => {
    const sluglines = texts(result, "SLUGLINE");
    assert.equal(sluglines.length, 16);
    assert.ok(sluglines.some((t) => t.startsWith("11А. ")));
    assert.ok(sluglines[0]!.startsWith("1. НАТ. ЗАГОРОДНЫЙ ДОМ"));
  });

  test("R3: профиль отступов найден по файлу (5,6 / 4,1 / 2,5 см)", () => {
    const profile = result.indentProfile;
    assert.ok(profile);
    assert.ok(Math.abs(profile.character / CM - 5.6) < 0.15, String(profile.character));
    assert.ok(profile.parenthetical != null);
    assert.ok(Math.abs(profile.parenthetical / CM - 4.1) < 0.15, String(profile.parenthetical));
    assert.ok(Math.abs(profile.dialogue / CM - 2.5) < 0.15, String(profile.dialogue));
    assert.ok(result.blocks.some((b) => b.level === "indent"));
  });

  test("R8: имена в репликах — МАМА, ПАПА, АННА, ДИКТОР, ДИАНА", () => {
    assert.deepEqual(cueNames(result), new Set(["МАМА", "ПАПА", "АННА", "ДИКТОР", "ДИАНА"]));
  });

  test("R9: переход «ЗАТЕМНЕНИЕ.»", () => {
    assert.deepEqual(texts(result, "TRANSITION"), ["ЗАТЕМНЕНИЕ."]);
  });

  test("R10: «РЕЖИССЕРСКАЯ ПОМЕТКА:» — примечание", () => {
    const notes = texts(result, "NOTE");
    assert.equal(notes.length, 1);
    assert.ok(notes[0]!.startsWith("РЕЖИССЕРСКАЯ ПОМЕТКА:"));
  });

  test("расхождений уровней нет", () => {
    assert.deepEqual(result.conflicts, []);
  });

  test("номера набраны текстом, автонумерации нет ни в одном абзаце", () => {
    assert.ok(fixtureParagraphs("moya-malenkaya-draft.docx").every((x) => x.autoNumber === null));
  });
});

describe("moya-malenkaya-v4.docx — русские стили", () => {
  const result = classifyFixture("moya-malenkaya-v4.docx");

  test("V1: титульная — до первой шапки, без имён и реплик", () => {
    const before = result.blocks.filter((b) => b.beforeFirstScene).map((b) => b.text.trim());
    for (const line of [
      "МОЯ МАЛЕНЬКАЯ",
      "Короткометражный художественный фильм",
      "Анастасия Некрасова",
      "версия 4.0",
      "03.07.2026",
      "Санкт-Петербург",
    ]) {
      assert.ok(before.includes(line), line);
    }
    assert.ok(result.blocks.filter((b) => b.beforeFirstScene).every((b) => b.type === "ACTION"));
  });

  test("V2, V3: 11 шапок по стилю «Заголовок сцены», в разном регистре", () => {
    const sluglines = result.blocks.filter((b) => b.type === "SLUGLINE");
    assert.equal(sluglines.length, 11);
    assert.ok(sluglines.every((b) => b.styleName === "Заголовок сцены"));
    assert.ok(sluglines.some((b) => b.text.startsWith("инт.")));
    assert.ok(sluglines.some((b) => b.text.startsWith("ИНт.")));
  });

  test("V6, V7: строки «Персонажи» и имена в репликах", () => {
    assert.equal(texts(result, "SCENE_CAST").length, 10);
    assert.deepEqual(cueNames(result), new Set(["МАМА", "ПАПА", "АННА", "ДИАНА"]));
  });

  test("V2: номера шапок 1.–11. из автонумерации Word (в тексте абзацев номеров нет)", () => {
    const sluglines = result.blocks.filter((b) => b.type === "SLUGLINE");
    assert.ok(sluglines.every((b) => !/^\s*\d/.test(b.text)));
    assert.deepEqual(
      sluglines.map((b) => (b.autoNumber?.kind === "number" ? b.autoNumber.label : b.autoNumber?.kind)),
      Array.from({ length: 11 }, (_, i) => `${i + 1}.`),
    );
    // Пронумерованы только шапки.
    assert.equal(fixtureParagraphs("moya-malenkaya-v4.docx").filter((x) => x.autoNumber).length, 11);
    assert.deepEqual(result.notices, []);
  });

  test("V8: «Переход через коридор в спальню.» — действие", () => {
    assert.deepEqual(texts(result, "TRANSITION"), []);
    const line = result.blocks.find((b) => b.text.startsWith("Переход через коридор"));
    assert.equal(line?.type, "ACTION");
  });

  test("расхождений уровней нет", () => {
    assert.deepEqual(result.conflicts, []);
  });
});

function paragraph(text: string, extra: Partial<DocxParagraph> = {}): DocxParagraph {
  return {
    index: 0,
    text,
    styleIds: [],
    styleNames: [],
    indentLeft: 0,
    align: "left",
    bold: false,
    autoNumber: null,
    ...extra,
  };
}

function classify(list: DocxParagraph[]) {
  return classifyParagraphs(list.map((p, index) => ({ ...p, index })));
}

describe("уровень 3 — только текст", () => {
  const result = classify([
    paragraph("СЦЕНАРИЙ"),
    paragraph("сц. 1 инт. кухня — день"),
    paragraph("Мама режет хлеб."),
    paragraph("МАМА (ЗК)"),
    paragraph("(тихо)"),
    paragraph("Иди есть."),
    paragraph("Пауза."),
    paragraph("ПРИМЕЧАНИЕ: снимаем одним кадром"),
    paragraph("Переход через коридор в спальню."),
    paragraph("СМЕНА КАДРА:"),
    paragraph("НАТ. ДВОР — НОЧЬ"),
  ]);

  test("типы по тексту и соседям", () => {
    assert.deepEqual(
      result.blocks.map((b) => [b.type, b.level]),
      [
        ["ACTION", "text"],
        ["SLUGLINE", "text"],
        ["ACTION", "text"],
        ["CHARACTER", "text"],
        ["PARENTHETICAL", "text"],
        ["DIALOGUE", "text"],
        ["ACTION", "text"],
        ["NOTE", "text"],
        ["ACTION", "text"],
        ["TRANSITION", "text"],
        ["SLUGLINE", "text"],
      ],
    );
    assert.equal(result.blocks[0]!.beforeFirstScene, true);
    assert.equal(result.indentProfile, null);
  });
});

describe("уровень 2 — профиль отступов", () => {
  const cue = (text: string) => paragraph(text, { indentLeft: 3400 });
  const line = (text: string) => paragraph(text, { indentLeft: 1700 });
  const result = classify([
    paragraph("1. ИНТ. КУХНЯ — ДЕНЬ", { bold: true }),
    cue("АННА"),
    line("Привет."),
    cue("ПАПА"),
    line("Здравствуй."),
    cue("АННА"),
    line("Пока."),
    paragraph("Анна уходит."),
  ]);

  test("имя и реплика — по отступу, действие — по тексту", () => {
    assert.deepEqual(result.indentProfile, { character: 3400, dialogue: 1700, parenthetical: null });
    assert.deepEqual(
      result.blocks.map((b) => [b.type, b.level]),
      [
        ["SLUGLINE", "text"],
        ["CHARACTER", "indent"],
        ["DIALOGUE", "indent"],
        ["CHARACTER", "indent"],
        ["DIALOGUE", "indent"],
        ["CHARACTER", "indent"],
        ["DIALOGUE", "indent"],
        ["ACTION", "text"],
      ],
    );
  });
});

describe("уровень 1 — стили и сверка с текстом", () => {
  const styled = (text: string, id: string, name: string) =>
    paragraph(text, { styleIds: [id], styleNames: [name] });

  test("стиль по названию и по id, без учёта регистра и пробелов", () => {
    const result = classify([
      styled("ИНТ. КУХНЯ — ДЕНЬ", "14", "заголовок  сцены"),
      styled("АННА", "CHARACTER", "Custom"),
      styled("Привет", "x", "РЕПЛИКА"),
      styled("Мама, анна", "y", "Персонажи"),
      styled("Общий план", "SHOT", "Shot"),
    ]);
    assert.deepEqual(
      result.blocks.map((b) => b.type),
      ["SLUGLINE", "CHARACTER", "DIALOGUE", "SCENE_CAST", "ACTION"],
    );
  });

  test("сверка обязана сработать: стиль CHARACTER, текст «ИНТ. КОМНАТА - ДЕНЬ»", () => {
    const result = classify([
      styled("1. ИНТ. КУХНЯ — ДЕНЬ", "SCENEHEADING", "SCENE HEADING"),
      styled("ИНТ. КОМНАТА - ДЕНЬ", "CHARACTER", "CHARACTER"),
    ]);
    assert.equal(result.conflicts.length, 1);
    assert.deepEqual(result.conflicts[0], {
      paragraphIndex: 1,
      text: "ИНТ. КОМНАТА - ДЕНЬ",
      assigned: "CHARACTER",
      suggested: "SLUGLINE",
      level: "style",
      reason: "looks_like_slugline",
    });
  });

  test("стиль «персонаж», а текст похож на шапку или на фразу — расхождение", () => {
    const result = classify([
      styled("1. ИНТ. КУХНЯ — ДЕНЬ", "SCENEHEADING", "SCENE HEADING"),
      styled("НАТ. ДВОР — НОЧЬ", "CHARACTER", "CHARACTER"),
      styled("Анна долго смотрит в окно и молчит.", "CHARACTER", "CHARACTER"),
      styled("ВИКТОРИЯ (ПРОД.)", "CHARACTER", "CHARACTER"),
    ]);
    assert.deepEqual(
      result.conflicts.map((c) => [c.assigned, c.suggested, c.reason]),
      [
        ["CHARACTER", "SLUGLINE", "looks_like_slugline"],
        ["CHARACTER", "ACTION", "character_looks_like_prose"],
      ],
    );
    // Тип остаётся по стилю — решение за пользователем на экране проверки.
    assert.equal(result.blocks[1]!.type, "CHARACTER");
  });
});

describe("чтение docx", () => {
  test("текст без разметки, сущности, стиль по умолчанию и наследование отступа", () => {
    const styles = `<w:styles>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/><w:pPr><w:ind w:left="2000"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Child"><w:name w:val="Имя героя"/><w:basedOn w:val="Base"/></w:style>
    </w:styles>`;
    const document = `<w:document><w:body>
      <w:p><w:r><w:t xml:space="preserve">A &lt;b&gt; &amp;</w:t></w:r><w:r><w:tab/><w:t>B</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Child"/></w:pPr><w:r><w:t>АННА</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Child"/><w:ind w:left="500"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>не жирный</w:t></w:r></w:p>
    </w:body></w:document>`;
    const [first, second, third] = parseDocxParagraphs(document, styles);
    assert.equal(first!.text, "A <b> &\tB");
    assert.deepEqual(first!.styleIds, ["Normal"]);
    assert.deepEqual(second!.styleNames, ["Имя героя", "Base"]);
    assert.equal(second!.indentLeft, 2000);
    assert.equal(second!.align, "center");
    assert.equal(second!.bold, true);
    assert.equal(third!.indentLeft, 500);
    assert.equal(third!.bold, false);
  });

});

describe("исправления Word, скрытый текст, комментарии (собранный docx)", () => {
  const docx = buildDocx({
    styles: `<w:style w:type="paragraph" w:styleId="Hidden"><w:name w:val="Hidden"/><w:rPr><w:vanish/></w:rPr></w:style>`,
    body:
      `<w:p><w:r><w:t xml:space="preserve">Анна </w:t></w:r>` +
      `<w:del w:id="1" w:author="a"><w:r><w:delText xml:space="preserve">старое </w:delText></w:r></w:del>` +
      `<w:ins w:id="2" w:author="a"><w:r><w:t xml:space="preserve">новое </w:t></w:r></w:ins>` +
      `<w:moveFrom w:id="3" w:author="a"><w:r><w:t xml:space="preserve">перенесённое </w:t></w:r></w:moveFrom>` +
      `<w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve">скрытое </w:t></w:r>` +
      `<w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>видимое</w:t></w:r>` +
      `<w:commentRangeStart w:id="5"/><w:r><w:commentReference w:id="5"/></w:r><w:commentRangeEnd w:id="5"/></w:p>` +
      // Удалён только знак абзаца (самозакрытый w:del) — текст абзаца остаётся.
      `<w:p><w:pPr><w:rPr><w:del w:id="6" w:author="a"/></w:rPr></w:pPr><w:r><w:t>ещё</w:t></w:r></w:p>` +
      // Прежнее форматирование из правки («было жирным») не учитывается.
      `<w:p><w:r><w:rPr><w:rPrChange w:id="7" w:author="a"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>не жирный</w:t></w:r></w:p>` +
      p("Скрыт стилем", "Hidden"),
    extra: [
      {
        name: "word/comments.xml",
        data: `<w:comments><w:comment w:id="5"><w:p><w:r><w:t>КОММЕНТАРИЙ</w:t></w:r></w:p></w:comment></w:comments>`,
      },
    ],
  });
  const paragraphs = readDocxParagraphs(docx);

  test("удалённое и перенесённое не читается, вставленное — читается", () => {
    assert.equal(paragraphs[0]!.text, "Анна новое видимое");
    assert.equal(paragraphs[1]!.text, "ещё");
  });

  test("скрытый текст (в прогоне и в стиле) не читается", () => {
    assert.ok(paragraphs.every((x) => !x.text.includes("скрытое")));
    assert.equal(paragraphs[3]!.text, "");
  });

  test("комментарии не читаются", () => {
    assert.ok(paragraphs.every((x) => !x.text.includes("КОММЕНТАРИЙ")));
    assert.equal(paragraphs.length, 4);
  });

  test("прежнее форматирование из правки не учитывается", () => {
    assert.equal(paragraphs[2]!.bold, false);
  });
});

describe("автонумерация шапок Word (собранный docx)", () => {
  const numbering =
    `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>` +
    `<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl></w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
    `<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>` +
    `<w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>` +
    `<w:num w:numId="4"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="10"/></w:lvlOverride></w:num>`;
  const styles = `<w:style w:type="paragraph" w:styleId="Scene"><w:name w:val="Заголовок сцены"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>`;
  const numPr = (numId: string, ilvl = 0) =>
    `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

  const labels = (result: BlockTypingResult) =>
    result.blocks
      .filter((b) => b.type === "SLUGLINE")
      .map((b) => (b.autoNumber?.kind === "number" ? b.autoNumber.label : b.autoNumber?.kind));

  test("простой десятичный список из стиля шапки — номера посчитаны", () => {
    const result = classifyParagraphs(
      readDocxParagraphs(
        buildDocx({
          styles,
          numbering,
          body:
            p("ИНТ. КУХНЯ — ДЕНЬ", "Scene") +
            p("Мама режет хлеб.") +
            p("НАТ. ДВОР — НОЧЬ", "Scene") +
            p("ИНТ. КОМНАТА — ДЕНЬ", "Scene"),
        }),
      ),
    );
    assert.deepEqual(labels(result), ["1.", "2.", "3."]);
    assert.deepEqual(result.notices, []);
  });

  test("нумерация в самом абзаце и «начать с 10»", () => {
    const result = classifyParagraphs(
      readDocxParagraphs(
        buildDocx({
          numbering,
          body: p("ИНТ. КУХНЯ — ДЕНЬ", undefined, numPr("4")) + p("НАТ. ДВОР — НОЧЬ", undefined, numPr("4")),
        }),
      ),
    );
    assert.deepEqual(labels(result), ["10.", "11."]);
  });

  test("составной, буквенный или неописанный список — пометка для вопроса", () => {
    const result = classifyParagraphs(
      readDocxParagraphs(
        buildDocx({
          numbering,
          body:
            p("ИНТ. КУХНЯ — ДЕНЬ", undefined, numPr("2", 1)) +
            p("НАТ. ДВОР — НОЧЬ", undefined, numPr("3")) +
            p("ИНТ. КОМНАТА — ДЕНЬ", undefined, numPr("99")),
        }),
      ),
    );
    assert.deepEqual(labels(result), ["unreadable", "unreadable", "unreadable"]);
    assert.deepEqual(result.notices, [
      { code: "slugline_autonumber_unreadable", paragraphIndexes: [0, 1, 2] },
    ]);
  });
});

describe("строка «Персонажи:» по тексту", () => {
  test("сразу после шапки — строка персонажей, в другом месте — действие", () => {
    const result = classify([
      paragraph("ИНТ. КУХНЯ — ДЕНЬ"),
      paragraph("Персонажи: Мама, Анна"),
      paragraph("Мама режет хлеб."),
      paragraph("ПЕРСОНАЖИ: папа"),
      paragraph("НАТ. ДВОР — НОЧЬ"),
      paragraph("ПЕРСОНАЖИ: АННА", { styleIds: ["7"], styleNames: ["Описание действия"] }),
    ]);
    assert.deepEqual(
      result.blocks.map((b) => b.type),
      ["SLUGLINE", "SCENE_CAST", "ACTION", "ACTION", "SLUGLINE", "SCENE_CAST"],
    );
  });
});

describe("лимиты распаковки и проверка по содержимому", () => {
  const isCode = (code: string) => (error: unknown) =>
    error instanceof DocxReadError && error.code === code;

  test("распакованный архив больше 30 МБ — отказ", () => {
    const docx = buildDocx({
      body: p("ИНТ. КУХНЯ — ДЕНЬ"),
      extra: [
        { name: "word/media/big.bin", data: Buffer.alloc(DOCX_LIMITS.maxTotalUncompressed + 1) },
      ],
    });
    assert.ok(docx.length < 1024 * 1024); // сжатый файл маленький
    assert.throws(() => readDocxParagraphs(docx), isCode("too_large"));
  });

  test("архив врёт о размере — распаковка останавливается на лимите", () => {
    const docx = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      {
        name: "word/document.xml",
        data: Buffer.alloc(DOCX_LIMITS.maxDocumentXml + 1024, "a"),
        declaredSize: 100,
      },
    ]);
    assert.throws(() => readDocxParagraphs(docx), isCode("too_large"));
  });

  test("слишком много файлов в архиве — отказ", () => {
    const files = Array.from({ length: DOCX_LIMITS.maxEntries + 1 }, (_, i) => ({
      name: `f${i}.xml`,
      data: "x",
      method: 0 as const,
    }));
    assert.throws(() => readDocxParagraphs(buildZip(files)), isCode("too_many_files"));
  });

  test("не docx с расширением .docx: таблица Excel, PDF, текст — отказ", () => {
    const xlsx = buildZip([
      { name: "[Content_Types].xml", data: "<Types/>" },
      { name: "xl/workbook.xml", data: "<workbook/>" },
    ]);
    assert.throws(() => readDocxParagraphs(xlsx), isCode("not_docx"));
    assert.throws(
      () => readDocxParagraphs(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n")),
      isCode("not_zip"),
    );
    assert.throws(() => readDocxParagraphs(Buffer.from("это не docx, а текст")), isCode("not_zip"));
  });
});
