import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { classifyParagraphs } from "@/features/import/normalize/block-types";
import {
  rulesFromAnswers,
  type DictionaryRule,
  type DictionaryRuleDraft,
  type DictionaryTarget,
} from "@/features/import/normalize/dictionary";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import {
  normalizeScript,
  QUESTION_TYPES,
  type Answers,
  type ExistingRecords,
  type NormalizeContext,
  type NormalizedScript,
} from "@/features/import/normalize/normalize-script";
import { compareKey } from "@/features/import/normalize/text";

// Ожидания — утверждённая таблица в docs/tasks/WAVE_4_NOTES.md (P1) и решения шага 3.

const FIXTURES = path.join(process.cwd(), "docs", "tasks", "fixtures", "scripts");
const FILES = ["ddct.docx", "moya-malenkaya-draft.docx", "moya-malenkaya-v4.docx"];

function normalizeFixture(name: string, answers: Answers = {}, context: NormalizeContext = {}) {
  const paragraphs = readDocxParagraphs(readFileSync(path.join(FIXTURES, name)));
  return normalizeScript(classifyParagraphs(paragraphs), answers, context);
}

function codes(result: NormalizedScript) {
  return result.questions.map((q) => q.code).sort();
}

/**
 * Как будет при записи (шаг 6): новые персонажи и локации получают id, правила с целью
 * «по имени» — id созданной записи.
 */
function afterImport(result: NormalizedScript, drafts: DictionaryRuleDraft[]) {
  const characters = result.characters.map((c) => ({
    id: c.existingId ?? `персонаж:${c.key}`,
    name: c.name,
  }));
  const locations = result.locations.flatMap((l) =>
    [null, ...l.subs].map((sublocation) => ({
      id: l.existing?.id ?? `локация:${l.key}|${sublocation ?? ""}`,
      name: l.object,
      sublocation,
    })),
  );
  const resolveTarget = (target: DictionaryRuleDraft["target"]): DictionaryTarget | null => {
    if (!target || "id" in target) return target;
    const records = target.kind === "character" ? characters : locations;
    const found = records.find((r) => r.name === target.name);
    assert.ok(found, `нет созданной записи ${target.name}`);
    return { kind: target.kind, id: found.id };
  };
  const dictionary: DictionaryRule[] = drafts.map((d) => ({ ...d, target: resolveTarget(d.target) }));
  return { existing: { characters, locations }, dictionary };
}

/** Ответить на все постоянные вопросы: через один — последний вариант и первый («да» и «нет»). */
function answerPersistent(name: string, offset: number) {
  const answers: Record<string, string> = {};
  let result = normalizeFixture(name);
  let n = offset;
  for (let round = 0; round < 5; round++) {
    const open = result.questions.filter((q) => q.persistent && !(q.code in answers));
    if (open.length === 0) break;
    for (const q of open) answers[q.code] = n++ % 2 === 0 ? q.options.at(-1)! : q.options[0]!;
    result = normalizeFixture(name, answers);
  }
  return { answers, result };
}

function snapshot(result: NormalizedScript) {
  return {
    blocks: result.blocks.map((b) => `${b.type}|${b.text}|${b.speaker ?? ""}`),
    scenes: result.scenes.map((s) => ({
      number: s.number,
      heading: s.heading,
      places: s.locations.map((l) => `${compareKey(l.object)} › ${l.sub ? compareKey(l.sub) : ""}`),
      characters: s.characters,
    })),
    characters: result.characters.map((c) => c.name).sort(),
    oneOff: result.questions.filter((q) => !q.persistent).map((q) => q.code).sort(),
  };
}

describe("P1: повторный прогон со словарём", () => {
  for (const name of FILES) {
    for (const offset of [0, 1]) {
      test(`${name}, ответы с ${offset === 0 ? "«да»" : "«нет»"}: постоянных вопросов нет, результат тот же`, () => {
        const first = answerPersistent(name, offset);
        const drafts = rulesFromAnswers(first.result, first.answers);
        assert.equal(drafts.length, Object.keys(first.answers).length);
        const context = afterImport(first.result, drafts);

        const again = normalizeFixture(name, {}, context);
        assert.deepEqual(
          again.questions.filter((q) => q.persistent).map((q) => q.code),
          [],
        );
        assert.deepEqual(again.staleRules, []);
        assert.deepEqual(snapshot(again), snapshot(first.result));
        assert.ok(again.characters.every((c) => c.existingId), "все персонажи привязаны");
        assert.ok(again.locations.every((l) => l.existing), "все объекты привязаны");
      });
    }
  }

  test("словарь без записей проекта: «нет» и ответы без цели применяются молча", () => {
    const answers = {
      "персонаж:СТАЖЕР1": "typo",
      "шапка-не-сцена:ЗАКАДРОВЫЙ ГОЛОС": "note",
      "похожие-персонажи:АДМИНИСТРАТОР|АДМИНИСТРАТОР-ПОМОЩНИК": "different",
    };
    const first = normalizeFixture("ddct.docx", answers);
    const drafts = rulesFromAnswers(first, answers);
    assert.deepEqual(
      drafts.map((d) => [d.type, d.key, d.answer, d.target]),
      [
        ["шапка-не-сцена", "ЗАКАДРОВЫЙ ГОЛОС", "note", null],
        ["персонаж", "СТАЖЕР1", "typo", null],
        ["похожие-персонажи", "АДМИНИСТРАТОР|АДМИНИСТРАТОР-ПОМОЩНИК", "different", null],
      ],
    );
    const again = normalizeFixture("ddct.docx", {}, {
      dictionary: drafts.map((d) => ({ ...d, target: null })),
    });
    for (const code of Object.keys(answers)) {
      assert.ok(!codes(again).includes(code), code);
      assert.ok(again.appliedRules.some((r) => r.code === code), code);
    }
    assert.equal(again.scenes.length, 35);
    assert.ok(again.characters.some((c) => c.key === "АДМИНИСТРАТОР"));
  });

  test("ответ пользователя старше правила словаря", () => {
    const code = "похожие-персонажи:АДМИНИСТРАТОР|АДМИНИСТРАТОР-ПОМОЩНИК";
    const result = normalizeFixture(
      "ddct.docx",
      { [code]: "same:АДМИНИСТРАТОР-ПОМОЩНИК" },
      {
        dictionary: [
          {
            type: QUESTION_TYPES.similarCharacters,
            key: "АДМИНИСТРАТОР|АДМИНИСТРАТОР-ПОМОЩНИК",
            answer: "different",
            target: null,
          },
        ],
      },
    );
    assert.ok(codes(result).includes(code));
    assert.ok(!result.characters.some((c) => c.key === "АДМИНИСТРАТОР"));
  });
});

describe("в словарь — только постоянные вопросы и только ответы пользователя", () => {
  test("ответы по умолчанию, которых не трогали, не сохраняются", () => {
    for (const name of FILES) {
      assert.deepEqual(rulesFromAnswers(normalizeFixture(name), {}), [], name);
    }
  });

  test("разовые вопросы не сохраняются", () => {
    const answers = { "нет-в-строке-персонажи:10:ДИАНА": "add" };
    const result = normalizeFixture("moya-malenkaya-v4.docx", answers);
    assert.deepEqual(rulesFromAnswers(result, answers), []);
  });

  test("неверный ответ (не из вариантов) не сохраняется", () => {
    const answers = { "персонаж:СТАЖЕР1": "что-то" };
    const result = normalizeFixture("ddct.docx", answers);
    assert.deepEqual(rulesFromAnswers(result, answers), []);
  });

  test("склейка с записью, которая создаётся этим же импортом, — цель по имени", () => {
    const answers = {
      "похожие-персонажи:АДМИНИСТРАТОР|АДМИНИСТРАТОР-ПОМОЩНИК": "same:АДМИНИСТРАТОР-ПОМОЩНИК",
      "похожие-локации:ДВОР ДОМА|ДОМ": "sub:ДОМ",
    };
    const ddct = normalizeFixture("ddct.docx", answers);
    assert.deepEqual(rulesFromAnswers(ddct, answers)[0]?.target, {
      kind: "character",
      name: "АДМИНИСТРАТОР-ПОМОЩНИК",
    });
    const draft = normalizeFixture("moya-malenkaya-draft.docx", answers);
    assert.deepEqual(rulesFromAnswers(draft, answers)[0]?.target, {
      kind: "location",
      name: "ДОМ",
    });
  });
});

describe("записи проекта", () => {
  test("точное совпадение после нормализации — привязка без вопроса", () => {
    const result = normalizeFixture("moya-malenkaya-v4.docx", {}, {
      existing: { characters: [{ id: "c-mama", name: "Мама" }], locations: [] },
    });
    assert.deepEqual(codes(result), ["нет-в-строке-персонажи:10:ДИАНА"]);
    const mama = result.characters.find((c) => c.existingId === "c-mama");
    assert.equal(mama?.key, "МАМА");
    assert.equal(result.characters.filter((c) => c.existingId).length, 1);
  });

  test("совпало с двумя записями (старые дубли) — вопрос «к какой привязать», не первая попавшаяся", () => {
    const existing: ExistingRecords = {
      characters: [
        { id: "m1", name: "МАМА" },
        { id: "m2", name: "Мама" },
      ],
      locations: [],
    };
    const code = "запись-персонажа:МАМА";
    const result = normalizeFixture("moya-malenkaya-v4.docx", {}, { existing });
    const q = result.questions.find((x) => x.code === code);
    assert.ok(q);
    assert.deepEqual(q.options, ["m1", "m2"]);
    assert.equal(q.required, true);
    assert.equal(q.persistent, true);
    assert.equal(q.answer, "");
    assert.equal(result.characters.find((c) => c.key === "МАМА")?.existingId, null);

    const answers = { [code]: "m2" };
    const answered = normalizeFixture("moya-malenkaya-v4.docx", answers, { existing });
    assert.equal(answered.characters.find((c) => c.key === "МАМА")?.existingId, "m2");
    const drafts = rulesFromAnswers(answered, answers);
    assert.deepEqual(drafts, [
      { type: code.split(":")[0], key: "МАМА", answer: "m2", target: { kind: "character", id: "m2" } },
    ]);

    const again = normalizeFixture("moya-malenkaya-v4.docx", {}, {
      existing,
      dictionary: drafts.map((d) => ({ ...d, target: { kind: "character", id: "m2" } })),
    });
    assert.ok(!codes(again).includes(code));
    assert.equal(again.characters.find((c) => c.key === "МАМА")?.existingId, "m2");
    assert.deepEqual(again.appliedRules.map((r) => r.code), [code]);
  });

  test("объект совпал с двумя написаниями в проекте — вопрос; строки одного объекта — не дубли", () => {
    const rows: ExistingRecords = {
      characters: [],
      locations: [
        { id: "l1", name: "Дом", sublocation: "Кухня" },
        { id: "l2", name: "Дом", sublocation: "Детская" },
      ],
    };
    const one = normalizeFixture("moya-malenkaya-draft.docx", {}, { existing: rows });
    assert.ok(!codes(one).some((c) => c.startsWith(QUESTION_TYPES.recordLocation)));
    assert.deepEqual(one.locations.find((l) => l.key === "ДОМ")?.existing, { id: "l1", name: "Дом" });

    const twins: ExistingRecords = {
      characters: [],
      locations: [
        { id: "a", name: "ДОМ", sublocation: null },
        { id: "b", name: "Дом", sublocation: null },
      ],
    };
    const two = normalizeFixture("moya-malenkaya-draft.docx", {}, { existing: twins });
    const q = two.questions.find((x) => x.code === "запись-локации:ДОМ");
    assert.deepEqual(q?.options, ["a", "b"]);
    assert.equal(q?.required, true);
  });

  test("похожее на запись проекта — вопрос «привязать или новая»; правило держит id, а не текст", () => {
    const existing: ExistingRecords = {
      characters: [{ id: "d", name: "ДИАННА" }],
      locations: [],
    };
    const code = "похожие-персонажи:ДИАНА|ДИАННА";
    const result = normalizeFixture("moya-malenkaya-v4.docx", {}, { existing });
    const q = result.questions.find((x) => x.code === code);
    assert.deepEqual(q?.options, ["different", "same:ДИАННА"]);
    assert.equal(q?.answer, "different");
    assert.equal(result.characters.find((c) => c.key === "ДИАНА")?.existingId, null);

    const answers = { [code]: "same:ДИАННА" };
    const answered = normalizeFixture("moya-malenkaya-v4.docx", answers, { existing });
    const diana = answered.characters.find((c) => c.existingId === "d");
    assert.deepEqual(diana?.sourceKeys, ["ДИАНА"]);
    assert.ok(answered.blocks.some((b) => b.speaker === diana?.key));
    const drafts = rulesFromAnswers(answered, answers);
    assert.deepEqual(drafts[0]?.target, { kind: "character", id: "d" });

    // Запись переименовали — правило не ломается: имя берётся у записи.
    const renamed = normalizeFixture("moya-malenkaya-v4.docx", {}, {
      existing: { characters: [{ id: "d", name: "Диана Петровна" }], locations: [] },
      dictionary: drafts.map((d) => ({ ...d, target: { kind: "character", id: "d" } })),
    });
    assert.ok(!renamed.questions.some((x) => x.type === QUESTION_TYPES.similarCharacters));
    const bound = renamed.characters.find((c) => c.existingId === "d");
    assert.equal(bound?.name, "Диана Петровна");
    assert.deepEqual(bound?.sourceKeys, ["ДИАНА"]);
  });

  test("похожий объект проекта — можно сделать подобъектом", () => {
    const existing: ExistingRecords = {
      characters: [],
      locations: [{ id: "flat", name: "КВАРТИРА МАМЫ", sublocation: null }],
    };
    const code = "похожие-локации:КВАРТИРА|КВАРТИРА МАМЫ";
    const answers = { [code]: "sub:КВАРТИРА МАМЫ" };
    const result = normalizeFixture("moya-malenkaya-v4.docx", answers, { existing });
    const flat = result.locations.find((l) => l.existing?.id === "flat");
    assert.ok(flat?.subs.includes("КВАРТИРА. СПАЛЬНЯ"));
    assert.deepEqual(flat?.sourceKeys, ["КВАРТИРА"]);
  });

  test("записи проекта между собой не сравниваются и не сливаются", () => {
    const existing: ExistingRecords = {
      characters: [
        { id: "a", name: "АДМИНИСТРАТОР" },
        { id: "b", name: "АДМИНИСТРАТОР-ПОМОЩНИК" },
      ],
      locations: [],
    };
    const result = normalizeFixture("ddct.docx", {}, { existing });
    assert.ok(!result.questions.some((q) => q.type === QUESTION_TYPES.similarCharacters));
    assert.equal(result.characters.find((c) => c.key === "АДМИНИСТРАТОР")?.existingId, "a");
    assert.equal(result.characters.find((c) => c.key === "АДМИНИСТРАТОР-ПОМОЩНИК")?.existingId, "b");
  });

  test("цель правила удалена или из чужого проекта — правило устарело, вопрос снова", () => {
    const existing: ExistingRecords = {
      characters: [
        { id: "m1", name: "МАМА" },
        { id: "m2", name: "Мама" },
      ],
      locations: [],
    };
    const stale: DictionaryRule[] = [
      // Запись удалена: в базе цель станет пустой.
      { type: QUESTION_TYPES.recordCharacter, key: "МАМА", answer: "m3", target: null },
      // Id записи другого проекта: в списке записей этого проекта его нет.
      {
        type: QUESTION_TYPES.similarCharacters,
        key: "ДИАНА|ДИАННА",
        answer: "same:ДИАННА",
        target: { kind: "character", id: "чужой" },
      },
    ];
    const result = normalizeFixture("moya-malenkaya-v4.docx", {}, { existing, dictionary: stale });
    assert.deepEqual(result.staleRules, stale);
    assert.deepEqual(result.appliedRules, []);
    assert.ok(codes(result).includes("запись-персонажа:МАМА"));
    assert.equal(result.characters.find((c) => c.key === "ДИАНА")?.existingId, null);
  });
});
