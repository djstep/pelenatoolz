import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { classifyParagraphs, type BlockTypingResult } from "@/features/import/normalize/block-types";
import {
  readDocxParagraphs,
  type DocxParagraph,
} from "@/features/import/normalize/docx-paragraphs";
import { parseHeading } from "@/features/import/normalize/heading";
import {
  normalizeScript,
  PERSISTENT_QUESTION_TYPES,
  QUESTION_TYPES,
  type Answers,
  type NormalizedScript,
  type QuestionType,
} from "@/features/import/normalize/normalize-script";
import { buildDocx, p } from "@/features/import/normalize/test-docx";
import { cleanText, compareKey } from "@/features/import/normalize/text";

// Ожидания — утверждённая таблица в docs/tasks/WAVE_4_NOTES.md (коды D*, R*, V*).

const FIXTURES = path.join(process.cwd(), "docs", "tasks", "fixtures", "scripts");

function fixtureParagraphs(name: string) {
  return readDocxParagraphs(readFileSync(path.join(FIXTURES, name)));
}

function normalizeParagraphs(paragraphs: DocxParagraph[], answers: Answers = {}) {
  return normalizeScript(
    classifyParagraphs(paragraphs.map((x, index) => ({ ...x, index }))),
    answers,
  );
}

function normalizeFixture(name: string, answers: Answers = {}) {
  return normalizeParagraphs(fixtureParagraphs(name), answers);
}

function normalizeDocx(body: string, answers: Answers = {}, numbering?: string) {
  return normalizeScript(
    classifyParagraphs(readDocxParagraphs(buildDocx({ body, numbering }))),
    answers,
  );
}

function questions(result: NormalizedScript, type: QuestionType) {
  return result.questions.filter((q) => q.type === type);
}

function question(result: NormalizedScript, code: string) {
  const found = result.questions.find((q) => q.code === code);
  assert.ok(found, `нет вопроса ${code}; есть: ${result.questions.map((q) => q.code).join(", ")}`);
  return found;
}

/** Номера сцен, где встречается вопрос. */
function sceneNumbers(result: NormalizedScript, paragraphIndexes: number[]) {
  return paragraphIndexes.map(
    (index) => result.scenes.find((s) => s.paragraphIndex === index)?.number ?? null,
  );
}

function scene(result: NormalizedScript, number: string) {
  const found = result.scenes.find((s) => s.number === number);
  assert.ok(found, `нет сцены ${number}`);
  return found;
}

function places(result: NormalizedScript, number: string) {
  return scene(result, number).locations.map((l) => (l.sub ? `${l.object} › ${l.sub}` : l.object));
}

function characterKeys(result: NormalizedScript) {
  return new Set(result.characters.map((c) => c.key));
}

function questionTypes(result: NormalizedScript) {
  return new Set(result.questions.map((q) => q.type));
}

function codes(result: NormalizedScript) {
  return result.questions.map((q) => q.code).sort();
}

describe("ddct.docx — нормализация", () => {
  const result = normalizeFixture("ddct.docx");

  test("вопросы только ожидаемых видов", () => {
    assert.deepEqual(
      questionTypes(result),
      new Set([
        QUESTION_TYPES.notScene,
        QUESTION_TYPES.timeMissing,
        QUESTION_TYPES.timeFromPrevious,
        QUESTION_TYPES.characterDigit,
      ]),
    );
  });

  test("D1: сцены 1–36; две пустые шапки и «37.» — не сцены, о них сказано", () => {
    assert.deepEqual(
      result.scenes.map((s) => s.number),
      Array.from({ length: 36 }, (_, i) => String(i + 1)),
    );
    const notice = (code: string) =>
      result.notices.find((n) => n.code === code)?.paragraphIndexes.length ?? 0;
    assert.equal(notice("slugline_empty"), 2);
    assert.equal(notice("slugline_number_only"), 1);
    assert.equal(result.titlePage, null);
  });

  test("D2, D3: «ЗАКАДРОВЫЙ ГОЛОС» — вопрос «сцена или пометка»", () => {
    assert.deepEqual(sceneNumbers(result, question(result, "шапка-не-сцена:ЗАКАДРОВЫЙ ГОЛОС").occurrences.map((o) => o.paragraphIndex)), ["1"]);
    assert.deepEqual(sceneNumbers(result, question(result, "шапка-не-сцена:ИНТ. ЗАКАДРОВЫЙ ГОЛОС").occurrences.map((o) => o.paragraphIndex)), ["36"]);
  });

  test("D2, D3: ответ «не сцена» → примечание на своём месте, номера не сдвигаются", () => {
    const answered = normalizeFixture("ddct.docx", {
      "шапка-не-сцена:ЗАКАДРОВЫЙ ГОЛОС": "note",
      "шапка-не-сцена:ИНТ. ЗАКАДРОВЫЙ ГОЛОС": "note",
    });
    assert.equal(answered.scenes.length, 34);
    assert.equal(answered.scenes[0]!.number, "2");
    assert.equal(answered.scenes.at(-1)!.number, "35");
    const notes = answered.blocks.filter((b) => b.type === "NOTE").map((b) => b.text);
    assert.deepEqual(notes, ["ЗАКАДРОВЫЙ ГОЛОС", "ИНТ. ЗАКАДРОВЫЙ ГОЛОС"]);
    // Текст после примечания — обычные блоки, не титульная.
    assert.equal(answered.titlePage, null);
    assert.ok(answered.blocks[1]!.sceneIndex === null);
    assert.ok(characterKeys(answered).has("АДМИНИСТРАТОР-ПОМОЩНИК"));
    // Сцена 36 стала примечанием — вопроса о режиме у неё нет.
    assert.equal(questions(answered, QUESTION_TYPES.timeMissing).flatMap((q) => q.occurrences).length, 4);
  });

  test("D4: без режима — разовый вопрос по каждой сцене: 2, 3, 4, 20, 36", () => {
    const missing = questions(result, QUESTION_TYPES.timeMissing);
    assert.deepEqual(missing.map((q) => q.code), [
      "режим-не-указан:2:ИНТ. КОМНАТА",
      "режим-не-указан:3:ИНТ. КОМНАТА",
      "режим-не-указан:4:ИНТ. КОМНАТА",
      "режим-не-указан:20:ИНТ. ОФИС КОМПАНИИ DDCT.КАБИНЕТ",
      "режим-не-указан:36:ИНТ. ЗАКАДРОВЫЙ ГОЛОС",
    ]);
    for (const q of missing) {
      assert.equal(q.persistent, false);
      assert.equal(q.acceptAll, true);
      assert.deepEqual(sceneNumbers(result, q.occurrences.map((o) => o.paragraphIndex)), [q.scene]);
    }
    assert.equal(scene(result, "2").time, null);
  });

  test("D4: «Принять все» одним значением — три вопроса сцен 2, 3, 4; ответ на одну сцену не трогает соседние", () => {
    const all = normalizeFixture("ddct.docx", {
      "режим-не-указан:2:ИНТ. КОМНАТА": "ДЕНЬ",
      "режим-не-указан:3:ИНТ. КОМНАТА": "ДЕНЬ",
      "режим-не-указан:4:ИНТ. КОМНАТА": "ДЕНЬ",
    });
    for (const number of ["2", "3", "4"]) {
      assert.equal(scene(all, number).time, "ДЕНЬ");
      assert.equal(scene(all, number).dayNight, "DAY");
    }
    assert.equal(scene(all, "3").heading, "3. ИНТ. КОМНАТА — ДЕНЬ");

    const one = normalizeFixture("ddct.docx", { "режим-не-указан:3:ИНТ. КОМНАТА": "НОЧЬ" });
    assert.deepEqual(
      ["2", "3", "4"].map((number) => scene(one, number).time),
      [null, "НОЧЬ", null],
    );
  });

  test("D5: пометка вместо режима — режим от предыдущей шапки, вопрос (можно «Принять все»)", () => {
    const fromPrevious = questions(result, QUESTION_TYPES.timeFromPrevious);
    assert.equal(fromPrevious.length, 7);
    assert.ok(fromPrevious.every((q) => q.acceptAll && !q.persistent && q.occurrences.length === 1));
    const byScene = Object.fromEntries(
      fromPrevious.flatMap((q) =>
        q.occurrences.map((o) => [sceneNumbers(result, [o.paragraphIndex])[0], o.detail]),
      ),
    );
    assert.deepEqual(byScene, {
      "6": "УТРО",
      "10": "УТРО",
      "15": "ДЕНЬ",
      "16": "ДЕНЬ",
      "23": "УТРО",
      "27": "УТРО",
      "30": "УТРО",
    });
    assert.equal(scene(result, "6").time, "УТРО");
    assert.equal(scene(result, "6").dayNight, "DAWN");
    assert.equal(scene(result, "6").note, "ПОЗЖЕ");
    assert.equal(
      scene(result, "6").heading,
      "6. ИНТ. ОФИС КОМПАНИИ ПО ПРОИЗВОДСТВУ СЪЕДОБНОЙ БУМАГИ — ПОЗЖЕ",
    );
    const rejected = normalizeFixture("ddct.docx", {
      "режим-от-предыдущей:6:ИНТ. ОФИС КОМПАНИИ ПО ПРОИЗВОДСТВУ СЪЕДОБНОЙ БУМАГИ — ПОЗЖЕ": "none",
    });
    assert.equal(scene(rejected, "6").time, null);
  });

  test("D6: «— СЛЕДУЮЩЕЕ УТРО» → режим УТРО и пометка, без вопроса", () => {
    const s19 = scene(result, "19");
    assert.equal(s19.time, "УТРО");
    assert.equal(s19.note, "СЛЕДУЮЩЕЕ УТРО");
    const asked = result.questions.flatMap((q) => q.occurrences.map((o) => o.paragraphIndex));
    assert.ok(!asked.includes(s19.paragraphIndex));
  });

  test("D7: точка — разделитель объекта и подобъекта, «DDCT» не меняется", () => {
    assert.deepEqual(places(result, "15"), ["ОФИС КОМПАНИИ DDCT › КАБИНЕТ"]);
    assert.deepEqual(places(result, "10"), ["ОФИС КОМПАНИИ DDCT › ПРИЕМНАЯ"]);
    assert.deepEqual(places(result, "13"), [
      "ОФИС КОМПАНИИ ПО ПРОИЗВОДСТВУ СЪЕДОБНОЙ БУМАГИ › ПЕРЕГОВОРНАЯ",
    ]);
    assert.ok(scene(result, "15").heading.includes("DDCT.КАБИНЕТ"));
  });

  test("D8: объекты", () => {
    assert.deepEqual(
      new Set(result.locations.map((l) => l.object)),
      new Set([
        "ЗАКАДРОВЫЙ ГОЛОС",
        "КОМНАТА",
        "ОФИС КОМПАНИИ ПО ПРОИЗВОДСТВУ СЪЕДОБНОЙ БУМАГИ",
        "КОРИДОР",
        "КВАРТИРА ВИКТОРИИ",
        "ОФИС КОМПАНИИ DDCT",
        "УЛИЦА",
        "КОРИДОР ОФИСА DDCT",
      ]),
    );
  });

  test("D9: 11 персонажей без дублей (кроме вопроса «СТАЖЕР1»)", () => {
    const asked = new Set(questions(result, QUESTION_TYPES.characterDigit).map((q) => q.subject));
    assert.deepEqual(
      new Set([...characterKeys(result)].filter((key) => !asked.has(key))),
      new Set([
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
      ]),
    );
    assert.equal(
      result.notices.find((n) => n.code === "character_empty")?.paragraphIndexes.length,
      11,
    );
  });

  test("D10: «СТАЖЕР1» — вопрос; «(ДАЛЬШЕ)» — не персонаж; (ПРОД.) — расширение", () => {
    const digit = question(result, "персонаж:СТАЖЕР1");
    assert.equal(digit.acceptAll, false);
    assert.equal(characterKeys(normalizeFixture("ddct.docx", { "персонаж:СТАЖЕР1": "typo" })).has("СТАЖЕР1"), false);
    assert.ok(characterKeys(normalizeFixture("ddct.docx", { "персонаж:СТАЖЕР1": "space" })).has("СТАЖЕР 1"));

    assert.equal(
      result.notices.find((n) => n.code === "cue_continuation")?.paragraphIndexes.length,
      3,
    );
    assert.ok(result.blocks.every((b) => !b.text.includes("(ДАЛЬШЕ)")));

    const prod = result.blocks.filter((b) => b.type === "CHARACTER" && b.text.includes("(ПРОД.)"));
    assert.deepEqual(prod.map((b) => b.speaker).sort(), ["МАКСИМ", "МАКСИМ", "НАЧАЛЬНИК"]);
    assert.ok(prod.every((b) => b.extensions?.includes("ПРОД.")));
    const zk = result.blocks.find((b) => b.sourceText === "АДМИНИСТРАТОР-ПОМОЩНИК(ЗК)");
    assert.equal(zk?.text, "АДМИНИСТРАТОР-ПОМОЩНИК (ЗК)");
    assert.equal(zk?.speaker, "АДМИНИСТРАТОР-ПОМОЩНИК");
  });

  test("D12: переходы CUT TO:, FADE TO BLACK", () => {
    assert.deepEqual(
      result.blocks.filter((b) => b.type === "TRANSITION").map((b) => b.text),
      ["CUT TO:", "FADE TO BLACK"],
    );
  });

  test("D13: возраст в действии персонажей не создаёт", () => {
    const keys = characterKeys(result);
    for (const name of ["КЛИЕНТ", "НАЧАЛЬНИКА", "ЮРИЯ", "СОТРУДНИКА", "ВИКТОРИЯ(27)"]) {
      assert.ok(!keys.has(name), name);
    }
    assert.ok(result.blocks.some((b) => b.type === "ACTION" && b.text.includes("ВИКТОРИЯ(27)")));
  });

  test("тире в шапке приведены к « — »", () => {
    assert.equal(
      scene(result, "5").heading,
      "5. ИНТ. ОФИС КОМПАНИИ ПО ПРОИЗВОДСТВУ СЪЕДОБНОЙ БУМАГИ — УТРО",
    );
  });
});

describe("moya-malenkaya-draft.docx — нормализация", () => {
  const result = normalizeFixture("moya-malenkaya-draft.docx");

  test("вопрос один — «два объекта» в сцене 9", () => {
    assert.deepEqual(codes(result), ["объекты:ДВОР ДОМА / ОПУШКА ЛЕСА"]);
  });

  test("R1: титульная", () => {
    assert.equal(result.titlePage?.title, "МОЯ МАЛЕНЬКАЯ");
    assert.equal(result.titlePage?.version, "Первый драфт режиссерской версии");
    assert.equal(result.titlePage?.date, "22.10.2026");
    assert.deepEqual(result.titlePage?.other, []);
    assert.ok(result.blocks.every((b) => b.text !== "МОЯ МАЛЕНЬКАЯ"));
  });

  test("R2: сцены 1–15 и 11А", () => {
    assert.deepEqual(result.scenes.map((s) => s.number), [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "11А", "12", "13", "14", "15",
    ]);
  });

  test("R4: объект «ДОМ» с подобъектами; несколько подобъектов в сценах 6, 10, 12, 15", () => {
    const dom = result.locations.find((l) => l.object === "ДОМ");
    assert.deepEqual(new Set(dom?.subs), new Set(["ДЕТСКАЯ", "КОРИДОР", "КУХНЯ", "ПРИХОЖАЯ"]));
    assert.deepEqual(
      new Set(result.locations.map((l) => l.object)),
      new Set(["ЗАГОРОДНЫЙ ДОМ", "ДОМ", "ДВОР ДОМА", "ОПУШКА ЛЕСА"]),
    );
    assert.deepEqual(places(result, "6"), ["ДОМ › ДЕТСКАЯ", "ДОМ › КОРИДОР"]);
    assert.deepEqual(places(result, "10"), ["ДОМ › ПРИХОЖАЯ", "ДОМ › ДЕТСКАЯ"]);
    assert.deepEqual(places(result, "12"), ["ДОМ › ДЕТСКАЯ", "ДОМ › КОРИДОР"]);
    assert.deepEqual(places(result, "15"), ["ДОМ › ДЕТСКАЯ", "ДОМ › КУХНЯ"]);
  });

  test("R5: «ДВОР ДОМА / ОПУШКА ЛЕСА» — два объекта, вопрос; ответ «подобъект»", () => {
    assert.deepEqual(places(result, "9"), ["ДВОР ДОМА", "ОПУШКА ЛЕСА"]);
    const answered = normalizeFixture("moya-malenkaya-draft.docx", {
      "объекты:ДВОР ДОМА / ОПУШКА ЛЕСА": "sub",
    });
    assert.deepEqual(places(answered, "9"), ["ДВОР ДОМА", "ДВОР ДОМА › ОПУШКА ЛЕСА"]);
    assert.deepEqual(
      answered.locations.map((l) => l.object),
      ["ЗАГОРОДНЫЙ ДОМ", "ДОМ", "ДВОР ДОМА"],
    );
  });

  test("R7: «(ПОЗЖЕ)» после режима — пометка, режим из шапки", () => {
    for (const number of ["5", "11А"]) {
      assert.equal(scene(result, number).note, "ПОЗЖЕ");
      assert.ok(scene(result, number).time);
    }
    assert.equal(scene(result, "5").heading, "5. ИНТ. ДОМ. КУХНЯ — УТРО (ПОЗЖЕ)");
  });

  test("R8: персонажи; «(З.К.)» — расширение", () => {
    assert.deepEqual(characterKeys(result), new Set(["МАМА", "ПАПА", "АННА", "ДИКТОР", "ДИАНА"]));
    assert.ok(result.blocks.some((b) => b.text === "ДИКТОР (З.К.)" && b.speaker === "ДИКТОР"));
  });

  test("R9, R10: переход и примечание", () => {
    assert.deepEqual(
      result.blocks.filter((b) => b.type === "TRANSITION").map((b) => b.text),
      ["ЗАТЕМНЕНИЕ."],
    );
    assert.equal(result.blocks.filter((b) => b.type === "NOTE").length, 1);
  });
});

describe("moya-malenkaya-v4.docx — нормализация", () => {
  const result = normalizeFixture("moya-malenkaya-v4.docx");

  test("вопрос один — ДИАНА нет в строке «Персонажи» сцены 10", () => {
    assert.deepEqual(codes(result), ["нет-в-строке-персонажи:10:ДИАНА"]);
  });

  test("V1: титульная", () => {
    assert.deepEqual(result.titlePage, {
      title: "МОЯ МАЛЕНЬКАЯ",
      subtitle: "Короткометражный художественный фильм",
      author: "Анастасия Некрасова",
      version: "версия 4.0",
      date: "03.07.2026",
      city: "Санкт-Петербург",
      other: ["СЦЕНАРИЙ", "Автор сценария", "2026"],
      contacts: [],
    });
  });

  test("V2 (изменено): номера 1–11 из автонумерации Word, без вопроса", () => {
    assert.deepEqual(
      result.scenes.map((s) => s.number),
      Array.from({ length: 11 }, (_, i) => String(i + 1)),
    );
    assert.equal(questions(result, QUESTION_TYPES.numberAll).length, 0);
  });

  test("V3: шапки в разном регистре нормализуются", () => {
    assert.equal(scene(result, "1").heading, "1. ИНТ. КВАРТИРА/СПАЛЬНЯ///КОРИДОР — ДЕНЬ");
    assert.equal(scene(result, "5").time, "ДЕНЬ");
    assert.equal(scene(result, "9").heading, "9. ИНТ. КВАРТИРА/ДЕТСКАЯ — ВЕЧЕР");
  });

  test("V4: объект КВАРТИРА и подобъекты; дефис — не разделитель", () => {
    assert.deepEqual(result.locations.map((l) => l.object), ["КВАРТИРА"]);
    assert.deepEqual(
      new Set(result.locations[0]!.subs),
      new Set(["СПАЛЬНЯ", "КОРИДОР", "КУХНЯ-ГОСТИНАЯ", "ДЕТСКАЯ"]),
    );
    assert.deepEqual(places(result, "1"), ["КВАРТИРА › СПАЛЬНЯ", "КВАРТИРА › КОРИДОР"]);
  });

  test("V5: последняя шапка без тире — режим ВЕЧЕР", () => {
    const last = scene(result, "11");
    assert.equal(last.time, "ВЕЧЕР");
    assert.equal(last.dayNight, "DUSK");
    assert.equal(last.heading, "11. ИНТ. КВАРТИРА/КУХНЯ-ГОСТИНАЯ///КОРИДОР///ДЕТСКАЯ — ВЕЧЕР");
  });

  test("V6: персонажи без дублей; СОФИЯ только из строки «Персонажи»", () => {
    assert.deepEqual(characterKeys(result), new Set(["МАМА", "ПАПА", "АННА", "СОФИЯ", "ДИАНА"]));
    const sofia = result.characters.find((c) => c.key === "СОФИЯ");
    assert.equal(sofia?.speaks, false);
    assert.ok((sofia?.scenes.length ?? 0) > 0);
    const cues = result.blocks.filter((b) => b.type === "CHARACTER");
    assert.ok(cues.every((b) => b.text === b.text.toUpperCase()));
    assert.ok(cues.some((b) => b.sourceText === "МАМА(ЗК)" && b.text === "МАМА (ЗК)"));
  });

  test("V7: сверка «Персонажи» — только сцена 10; ответ «добавить»", () => {
    const missing = questions(result, QUESTION_TYPES.castMissing);
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!.occurrences.length, 1);
    const castBlock = result.blocks.find((b) => b.paragraphIndex === missing[0]!.occurrences[0]!.paragraphIndex);
    assert.equal(castBlock?.sceneIndex, scene(result, "10").index);
    assert.ok(scene(result, "10").characters.includes("ДИАНА"));
    assert.equal(scene(result, "7").castLine, null);

    const answered = normalizeFixture("moya-malenkaya-v4.docx", { [missing[0]!.code]: "add" });
    const updated = answered.blocks.find((b) => b.paragraphIndex === castBlock!.paragraphIndex);
    assert.equal(updated?.text, "АННА, МАМА, СОФИЯ, ДИАНА");
  });

  test("V8: «Переход через коридор в спальню.» — действие", () => {
    assert.equal(result.blocks.filter((b) => b.type === "TRANSITION").length, 0);
  });
});

describe("коды вопросов из содержимого", () => {
  /** Лишняя сцена перед первой шапкой: копии абзацев шапки и действия того же файла. */
  function withExtraScene(name: string) {
    const paragraphs = fixtureParagraphs(name);
    const typing: BlockTypingResult = classifyParagraphs(paragraphs);
    const heading = typing.blocks.find((b) => b.type === "SLUGLINE")!;
    const action = typing.blocks.find((b) => b.type === "ACTION" && !b.beforeFirstScene)!;
    const at = heading.paragraphIndex;
    const extraAction = { ...paragraphs[action.paragraphIndex]!, text: "Пробная сцена." };
    if (!paragraphs[at]!.autoNumber) {
      const extraHeading = { ...paragraphs[at]!, text: "0. ИНТ. ПРОБНАЯ — ДЕНЬ" };
      return [...paragraphs.slice(0, at), extraHeading, extraAction, ...paragraphs.slice(at)];
    }
    // Автонумерация Word: вставка первой сцены сдвигает номера всех следующих шапок.
    const shift = (x: DocxParagraph): DocxParagraph =>
      x.autoNumber?.kind === "number"
        ? {
            ...x,
            autoNumber: {
              kind: "number",
              value: x.autoNumber.value + 1,
              label: `${x.autoNumber.value + 1}.`,
            },
          }
        : x;
    const extraHeading: DocxParagraph = {
      ...paragraphs[at]!,
      text: "ИНТ. ПРОБНАЯ — ДЕНЬ",
      autoNumber: { kind: "number", value: 1, label: "1." },
    };
    return [
      ...paragraphs.slice(0, at),
      extraHeading,
      extraAction,
      ...paragraphs.slice(at).map(shift),
    ];
  }

  const persistentCodes = (result: NormalizedScript) =>
    result.questions.filter((q) => q.persistent).map((q) => q.code).sort();

  for (const name of ["ddct.docx", "moya-malenkaya-draft.docx", "moya-malenkaya-v4.docx"]) {
    test(`${name}: лишняя сцена в начале — те же коды постоянных вопросов`, () => {
      const original = normalizeFixture(name);
      const shifted = normalizeParagraphs(withExtraScene(name));
      assert.equal(shifted.scenes.length, original.scenes.length + 1);
      assert.deepEqual(persistentCodes(shifted), persistentCodes(original));
    });
  }

  test("v4: автонумерация сдвинулась — разовый вопрос получает новый номер сцены", () => {
    const shifted = normalizeParagraphs(withExtraScene("moya-malenkaya-v4.docx"));
    assert.deepEqual(codes(shifted), ["нет-в-строке-персонажи:11:ДИАНА"]);
  });

  test("постоянные — без номеров сцен; разовые по сцене — с номером сцены", () => {
    for (const name of ["ddct.docx", "moya-malenkaya-draft.docx", "moya-malenkaya-v4.docx"]) {
      for (const q of normalizeFixture(name).questions) {
        if (q.persistent) {
          assert.equal(q.scene, null, q.code);
          assert.equal(q.code, `${q.type}:${q.subject}`);
        } else {
          assert.ok(q.scene, q.code);
          assert.equal(q.code, `${q.type}:${q.scene}:${q.subject}`);
        }
      }
    }
  });

  test("какие вопросы постоянные, какие разовые", () => {
    assert.deepEqual(
      Object.values(QUESTION_TYPES).filter((type) => PERSISTENT_QUESTION_TYPES.has(type)),
      [
        QUESTION_TYPES.notScene,
        QUESTION_TYPES.objects,
        QUESTION_TYPES.characterDigit,
        QUESTION_TYPES.latinWord,
        QUESTION_TYPES.latinInWord,
      ],
    );
  });
});

describe("номера сцен (собранные файлы)", () => {
  test("ни одного номера — вопрос «пронумеровать подряд»", () => {
    const body = p("ИНТ. КУХНЯ — ДЕНЬ") + p("Мама режет хлеб.") + p("НАТ. ДВОР — НОЧЬ") + p("Тихо.");
    const result = normalizeDocx(body);
    const numbering = question(result, "нумерация:подряд");
    assert.equal(numbering.acceptAll, false);
    assert.deepEqual(numbering.occurrences.map((o) => o.detail), ["1", "2"]);
    assert.deepEqual(result.scenes.map((s) => s.number), ["1", "2"]);
    assert.equal(result.scenes[1]!.heading, "2. НАТ. ДВОР — НОЧЬ");
    const kept = normalizeDocx(body, { "нумерация:подряд": "keep" });
    assert.deepEqual(kept.scenes.map((s) => s.number), [null, null]);
  });

  test("часть с номерами, часть без — вопрос по сцене, предложен номер-вставка", () => {
    const body =
      p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("Мама режет хлеб.") +
      p("ИНТ. КОРИДОР — ДЕНЬ") + p("Пусто.") +
      p("2. НАТ. ДВОР — НОЧЬ") + p("Тихо.");
    const result = normalizeDocx(body);
    const code = "номер-не-указан:п2:ИНТ. КОРИДОР — ДЕНЬ";
    const missing = question(result, code);
    assert.equal(missing.persistent, false);
    assert.deepEqual(missing.occurrences.map((o) => o.detail), ["1А"]);
    assert.deepEqual(result.scenes.map((s) => s.number), ["1", "1А", "2"]);
    const manual = normalizeDocx(body, { [code]: "1б" });
    assert.equal(manual.scenes[1]!.number, "1Б");
    const kept = normalizeDocx(body, { [code]: "keep" });
    assert.equal(kept.scenes[1]!.number, null);
  });

  test("одинаковый номер у двух сцен — разовый вопрос у второй, предложена буква", () => {
    const body =
      p("5. ИНТ. КУХНЯ — ДЕНЬ") + p("Раз.") +
      p("5. НАТ. ДВОР — НОЧЬ") + p("Два.") +
      p("5А. ИНТ. КОРИДОР — НОЧЬ") + p("Три.");
    const result = normalizeDocx(body);
    assert.deepEqual(codes(result), ["номер-повтор:5#2:НАТ. ДВОР — НОЧЬ"]);
    const duplicate = question(result, "номер-повтор:5#2:НАТ. ДВОР — НОЧЬ");
    assert.deepEqual(duplicate.occurrences.map((o) => o.detail), ["5Б"]);
    assert.deepEqual(result.scenes.map((s) => s.number), ["5", "5", "5А"]);
    const fixed = normalizeDocx(body, { "номер-повтор:5#2:НАТ. ДВОР — НОЧЬ": "suggested" });
    assert.deepEqual(fixed.scenes.map((s) => s.number), ["5", "5Б", "5А"]);
    const manual = normalizeDocx(body, { "номер-повтор:5#2:НАТ. ДВОР — НОЧЬ": "5в" });
    assert.equal(manual.scenes[1]!.number, "5В");
  });

  test("одинаковые шапки без режима — отдельный вопрос по каждой сцене", () => {
    const result = normalizeDocx(
      p("1. ИНТ. КОМНАТА") + p("Раз.") + p("2. ИНТ. КОМНАТА") + p("Два."),
    );
    assert.deepEqual(codes(result), [
      "режим-не-указан:1:ИНТ. КОМНАТА",
      "режим-не-указан:2:ИНТ. КОМНАТА",
    ]);
  });

  test("буква в номере: 11a, 11A → 11А", () => {
    const result = normalizeDocx(p("11a. ИНТ. КУХНЯ — ДЕНЬ") + p("Раз.") + p("12A инт. кухня — день") + p("Два."));
    assert.deepEqual(result.scenes.map((s) => s.number), ["11А", "12А"]);
    assert.equal(result.scenes[1]!.heading, "12А. ИНТ. КУХНЯ — ДЕНЬ");
  });

  test("автонумерация Word — номер без вопроса", () => {
    const numbering =
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`;
    const numPr = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`;
    const result = normalizeDocx(
      p("ИНТ. КУХНЯ — ДЕНЬ", undefined, numPr) + p("Раз.") + p("НАТ. ДВОР — НОЧЬ", undefined, numPr),
      {},
      numbering,
    );
    assert.deepEqual(result.scenes.map((s) => s.number), ["1", "2"]);
    assert.deepEqual(result.questions, []);
  });
});

describe("символы и латиница (собранные файлы)", () => {
  test("пробелы, тире, Ё = Е при сравнении", () => {
    assert.equal(cleanText("  Мама  режет  хлеб - быстро  "), "Мама режет хлеб — быстро");
    assert.equal(cleanText("кухня-гостиная – 1990−2000"), "кухня-гостиная — 1990—2000");
    assert.equal(compareKey("Стажёр"), compareKey("СТАЖЕР"));
  });

  test("латиница внутри кириллического слова — правка в «Принять все»", () => {
    const body = p("1. ИНТ. КВАPТИРА — ДЕНЬ") + p("АННА") + p("Привет.");
    const result = normalizeDocx(body);
    const fix = question(result, "латиница-в-слове:КВАPТИРА");
    assert.equal(fix.acceptAll, true);
    assert.equal(result.scenes[0]!.heading, "1. ИНТ. КВАРТИРА — ДЕНЬ");
    assert.equal(result.locations[0]!.object, "КВАРТИРА");
    const kept = normalizeDocx(body, { "латиница-в-слове:КВАPТИРА": "keep" });
    assert.equal(kept.locations[0]!.object, "КВАPТИРА");
  });

  test("слово целиком латиницей (MAMA) — отдельный вопрос, не в «Принять все»", () => {
    const body = p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("MAMA") + p("Иди есть.") + p("МАМА") + p("Иду.");
    const result = normalizeDocx(body);
    const latin = question(result, "латиница:MAMA");
    assert.equal(latin.acceptAll, false);
    assert.deepEqual(characterKeys(result), new Set(["MAMA", "МАМА"]));
    const replaced = normalizeDocx(body, { "латиница:MAMA": "replace" });
    assert.deepEqual(characterKeys(replaced), new Set(["МАМА"]));
  });

  test("текст в базу — только текст: латиница в реплике не спрашивается", () => {
    const result = normalizeDocx(p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("АННА") + p("Dreams dont come true."));
    assert.deepEqual(result.questions, []);
  });
});

describe("шапки: варианты записи", () => {
  const cases: [string, Partial<ReturnType<typeof parseHeading>>][] = [
    ["Сц. 1 инт. кухня — день", { number: "1", intExt: "INT", place: "КУХНЯ", time: "ДЕНЬ" }],
    ["СЦЕНА 12 НАТ. ДВОР - НОЧЬ", { number: "12", intExt: "EXT", place: "ДВОР", time: "НОЧЬ" }],
    ["3. ИНТЕРЬЕР. ЗАЛ — ВЕЧЕР", { number: "3", intExt: "INT", place: "ЗАЛ", time: "ВЕЧЕР" }],
    ["4. НАТУРА. ПОЛЕ — РАССВЕТ", { intExt: "EXT", place: "ПОЛЕ", time: "РАССВЕТ" }],
    ["5. INT. KITCHEN — DAY", { intExt: "INT", intExtToken: "INT.", time: "DAY" }],
    ["6. EXT. YARD — NIGHT", { intExt: "EXT" }],
    ["7. ИНТ/НАТ. МАШИНА — ДЕНЬ", { intExt: "INT_EXT", intExtToken: "ИНТ/НАТ.", place: "МАШИНА" }],
    ["8. НАТ/ИНТ. МАШИНА — ДЕНЬ", { intExt: "INT_EXT" }],
    ["9. ИНТ-НАТ. МАШИНА — ДЕНЬ", { intExt: "INT_EXT" }],
    ["10 ИНТ.КУХНЯ — ДЕНЬ", { number: "10", intExtToken: "ИНТ.", place: "КУХНЯ" }],
    ["11. ИНТ. КВ. ИВАНА — ДЕНЬ", { place: "КВ. ИВАНА" }],
    ["12. ИНТ. ДОМ — СУМЕРКИ", { time: "СУМЕРКИ" }],
  ];
  for (const [text, expected] of cases) {
    test(text, () => {
      const parsed = parseHeading(cleanText(text));
      for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(parsed[key as keyof typeof parsed], value, key);
      }
    });
  }

  test("сокращение «КВ.» — не разделитель; режим СУМЕРКИ → ЗАКАТ", () => {
    assert.deepEqual(parseHeading("ИНТ. КВ. ИВАНА — ДЕНЬ").locations, [
      { object: "КВ. ИВАНА", sub: null, separate: false },
    ]);
    const result = normalizeDocx(p("1. ИНТ. ДОМ — СУМЕРКИ") + p("Тихо."));
    assert.equal(result.scenes[0]!.dayNight, "DUSK");
  });

  test("после « / » объект с подобъектом — другой объект, вопрос", () => {
    const result = normalizeDocx(p("1. ИНТ. ДОМ. КУХНЯ / ГАРАЖ. ЯМА — ДЕНЬ") + p("Тихо."));
    assert.ok(question(result, "объекты:ДОМ. КУХНЯ / ГАРАЖ. ЯМА"));
    assert.deepEqual(places(result, "1"), ["ДОМ › КУХНЯ", "ГАРАЖ › ЯМА"]);
  });
});

describe("имена, реплики, строка «Персонажи» (собранные файлы)", () => {
  test("«Персонажи : …» с пробелом перед двоеточием — строка персонажей", () => {
    const result = normalizeDocx(p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("Персонажи : Мама, анна") + p("Тихо."));
    assert.equal(result.blocks[1]!.type, "SCENE_CAST");
    assert.deepEqual(result.scenes[0]!.castLine, ["МАМА", "АННА"]);
    assert.equal(result.blocks[1]!.text, "Персонажи: МАМА, АННА");
  });

  test("ремарка после реплики и второй абзац — та же реплика", () => {
    const result = normalizeDocx(
      p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("АННА (5)") + p("Привет.") + p("(пауза)") + p("Пока.") + p("Анна уходит."),
    );
    assert.deepEqual(
      result.blocks.map((b) => [b.type, b.speaker]),
      [
        ["SLUGLINE", null],
        ["CHARACTER", "АННА"],
        ["DIALOGUE", "АННА"],
        ["PARENTHETICAL", "АННА"],
        ["DIALOGUE", "АННА"],
        ["ACTION", null],
      ],
    );
    // Возраст в скобках у имени не сохраняется и не становится расширением.
    assert.equal(result.blocks[1]!.text, "АННА");
    assert.deepEqual(result.blocks[1]!.extensions, []);
  });

  test("титульная: почта и телефон — в контакты, не в прочие строки", () => {
    const result = normalizeDocx(
      p("ДАЧА") + p("Автор: Иван Петров") + p("ivan@example.com") + p("+7 912 345-67-89") +
        p("г. Тверь, 2025") + p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("Тихо."),
    );
    assert.deepEqual(result.titlePage, {
      title: "ДАЧА",
      subtitle: null,
      author: "Иван Петров",
      version: null,
      date: null,
      city: "Тверь",
      other: [],
      contacts: ["ivan@example.com", "+7 912 345-67-89"],
    });
  });
});
