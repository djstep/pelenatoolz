import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { classifyParagraphs } from "@/features/import/normalize/block-types";
import { readDocxParagraphs } from "@/features/import/normalize/docx-paragraphs";
import {
  normalizeScript,
  QUESTION_TYPES,
  type Answers,
  type ExistingRecords,
  type NormalizedScript,
} from "@/features/import/normalize/normalize-script";
import { contentHash, headingKey, type ExistingScene } from "@/features/import/normalize/scene-match";
import { buildDocx, p } from "@/features/import/normalize/test-docx";
import { blockingQuestions, planImport, splitSceneNumber } from "@/features/import/write/plan";

// Сопоставление с прошлой версией и план записи (шаг 6). Новые ожидания, не из
// утверждённой таблицы: решения владельца 12 и ответы к плану шага 6а.

const FIXTURES = path.join(process.cwd(), "docs", "tasks", "fixtures", "scripts");
const TIMING = { mode: "PAGES" as const, pageToMinuteRatio: 1 };

function scene(partial: Partial<ExistingScene> & { id: string; number: string }): ExistingScene {
  return {
    heading: "",
    intExt: null,
    dayNight: null,
    cut: false,
    characterIds: [],
    locationIds: [],
    contentHash: contentHash(""),
    shootDays: [],
    reportFacts: 0,
    ...partial,
  };
}

function run(body: string, existing: ExistingRecords, answers: Answers = {}) {
  return normalizeScript(classifyParagraphs(readDocxParagraphs(buildDocx({ body }))), answers, {
    existing,
  });
}

function codesOf(result: NormalizedScript, type: string) {
  return result.questions.filter((q) => q.type === type).map((q) => q.code);
}

/** «Подтвердить все»: текущие варианты постоянных вопросов — явные ответы. */
function confirmAll(result: NormalizedScript): Answers {
  return Object.fromEntries(
    result.questions.filter((q) => q.persistent && q.answer && !q.confirmed).map((q) => [q.code, q.answer]),
  );
}

/** «ТЕСТ импорт» после шага 5: сцены 1–4, сцена 2 вырезана, 1 в дне 1, 3 в дне 2. */
const TEST_PROJECT: ExistingRecords = {
  characters: [],
  locations: [{ id: "loc-test", name: "ТЕСТ ЛОКАЦИЯ", sublocation: null }],
  scenes: [1, 2, 3, 4].map((n) =>
    scene({
      id: `s${n}`,
      number: String(n),
      heading: "ИНТ. ТЕСТ ЛОКАЦИЯ — ДЕНЬ",
      intExt: "INT",
      dayNight: "DAY",
      cut: n === 2,
      locationIds: ["loc-test"],
      shootDays: n === 1 ? [1] : n === 3 ? [2] : [],
    }),
  ),
};

describe("сопоставление сцен с проектом", () => {
  const body =
    p("1. ИНТ. КУХНЯ — ДЕНЬ") + p("Раз.") +
    p("2. ИНТ. КОМНАТА — НОЧЬ") + p("Два.") +
    p("3. НАТ. ДВОР — НОЧЬ") + p("Три.");
  const existing: ExistingRecords = {
    characters: [],
    locations: [
      { id: "l-kitchen", name: "КУХНЯ", sublocation: null },
      { id: "l-room", name: "КОМНАТА", sublocation: null },
    ],
    scenes: [
      scene({ id: "a", number: "1", heading: "1. ИНТ. КУХНЯ — ДЕНЬ", intExt: "INT", locationIds: ["l-kitchen"] }),
      scene({ id: "b", number: "2", heading: "2. ИНТ. КОМНАТА - ДЕНЬ", intExt: "INT", locationIds: ["l-room"] }),
      scene({ id: "c", number: "4", heading: "4. ИНТ. ПОДВАЛ — НОЧЬ", intExt: "INT" }),
    ],
  };

  test("по номеру: совпала, шапка изменилась; новая; нет в новой версии — вопрос «вырезать?»", () => {
    const result = run(body, existing);
    const [first, second, third] = result.sceneMatches;
    assert.equal(first!.existingId, "a");
    assert.equal(first!.headingChanged, false);
    assert.equal(second!.existingId, "b");
    assert.equal(second!.headingChanged, true);
    assert.equal(second!.previousHeading, "2. ИНТ. КОМНАТА - ДЕНЬ");
    assert.equal(third!.existingId, null);
    assert.equal(third!.number, "3");
    assert.deepEqual(codesOf(result, QUESTION_TYPES.cutScene), ["сцена-вырезать:4:ИНТ. ПОДВАЛ — НОЧЬ"]);
    assert.equal(result.missingScenes[0]!.cut, false);
    const cut = run(body, existing, { "сцена-вырезать:4:ИНТ. ПОДВАЛ — НОЧЬ": "cut" });
    assert.equal(cut.missingScenes[0]!.cut, true);
  });

  test("по шапке, если номера нет в проекте", () => {
    const moved = p("7. ИНТ. ПОДВАЛ — НОЧЬ") + p("Тут.");
    const result = run(moved, existing);
    assert.equal(result.sceneMatches[0]!.existingId, "c");
    assert.equal(result.sceneMatches[0]!.by, "heading");
    // Номер в либретто не меняется.
    assert.equal(result.sceneMatches[0]!.number, "4");
  });

  test("вырезанная сцена в файле — обязательный «вернуть?», без ответа импорт нельзя", () => {
    const result = run(p("2. ИНТ. КОМНАТА") + p("Снова."), TEST_PROJECT);
    const code = "сцена-вернуть:2:ИНТ. КОМНАТА";
    const q = result.questions.find((x) => x.code === code);
    assert.ok(q);
    assert.equal(q.required, true);
    assert.equal(q.suggested, "");
    assert.ok(blockingQuestions(result) > 0);
    const restored = run(p("2. ИНТ. КОМНАТА") + p("Снова."), TEST_PROJECT, { [code]: "restore" });
    assert.equal(restored.sceneMatches[0]!.existingId, "s2");
    assert.equal(restored.sceneMatches[0]!.restore, true);
    assert.equal(blockingQuestions(restored), 0);
  });

  test("«вернуть?» → «новая»: номер занят вырезанной сценой — вопрос «номер занят», предложена буква", () => {
    const answers = { "сцена-вернуть:2:ИНТ. КОМНАТА": "new" };
    const result = run(p("2. ИНТ. КОМНАТА") + p("Снова."), TEST_PROJECT, answers);
    assert.equal(result.sceneMatches[0]!.existingId, null);
    const taken = result.questions.find((q) => q.type === QUESTION_TYPES.numberTaken);
    assert.ok(taken);
    assert.equal(taken.code, "номер-занят:2:ИНТ. КОМНАТА");
    assert.equal(taken.occurrences[0]!.detail, "2А");
    assert.equal(result.sceneMatches[0]!.number, "2А");
    const own = run(p("2. ИНТ. КОМНАТА") + p("Снова."), TEST_PROJECT, {
      ...answers,
      "номер-занят:2:ИНТ. КОМНАТА": "12б",
    });
    assert.equal(own.sceneMatches[0]!.number, "12Б");
    // Занятый номер вручную не принимается.
    const busy = run(p("2. ИНТ. КОМНАТА") + p("Снова."), TEST_PROJECT, {
      ...answers,
      "номер-занят:2:ИНТ. КОМНАТА": "3",
    });
    assert.equal(busy.sceneMatches[0]!.number, "2А");
  });

  test("связь, которой нет в новой версии, — вопрос «убрать связь?», без ответа остаётся", () => {
    // Объект другой — сначала «та же сцена?»; пока нет ответа, о связях не спрашиваем.
    const body = p("1. ИНТ. КОМНАТА — ДЕНЬ") + p("Раз.");
    const same = { "та-же-сцена:1:ИНТ. КОМНАТА — ДЕНЬ": "same" };
    assert.deepEqual(codesOf(run(body, TEST_PROJECT), QUESTION_TYPES.unlinkLocation), []);
    const result = run(body, TEST_PROJECT, same);
    const code = "связь-локации:1:ТЕСТ ЛОКАЦИЯ";
    assert.deepEqual(codesOf(result, QUESTION_TYPES.unlinkLocation), [code]);
    assert.deepEqual(result.sceneMatches[0]!.removeLocationIds, []);
    const removed = run(body, TEST_PROJECT, { ...same, [code]: "remove" });
    assert.deepEqual(removed.sceneMatches[0]!.removeLocationIds, ["loc-test"]);
  });
});

describe("перенумерация: «та же сцена?»", () => {
  const existing: ExistingRecords = {
    characters: [],
    locations: [
      { id: "l-kitchen", name: "КУХНЯ", sublocation: null },
      { id: "l-yard", name: "ДВОР", sublocation: null },
    ],
    scenes: [
      scene({ id: "k", number: "5", heading: "5. ИНТ. КУХНЯ — ДЕНЬ", intExt: "INT", locationIds: ["l-kitchen"] }),
      scene({ id: "y", number: "6", heading: "6. НАТ. ДВОР — НОЧЬ", intExt: "EXT", locationIds: ["l-yard"] }),
    ],
  };

  test("поменялся объект (ИНТ/НАТ тот же) — обязательный вопрос, ответ «новая»", () => {
    const body = p("5. ИНТ. ЛЕС — ДЕНЬ") + p("Лес.") + p("6. НАТ. ДВОР — НОЧЬ") + p("Двор.");
    const result = run(body, existing);
    const code = "та-же-сцена:5:ИНТ. ЛЕС — ДЕНЬ";
    const q = result.questions.find((x) => x.code === code);
    assert.ok(q);
    assert.equal(q.required, true);
    assert.deepEqual(q.options, ["same", "new"]);
    assert.equal(result.sceneMatches[0]!.pending, true);
    assert.ok(blockingQuestions(result) > 0);

    const same = run(body, existing, { [code]: "same" });
    assert.equal(same.sceneMatches[0]!.existingId, "k");
    assert.equal(blockingQuestions(same), 0);

    const fresh = run(body, existing, { [code]: "new" });
    assert.equal(fresh.sceneMatches[0]!.existingId, null);
    assert.equal(fresh.sceneMatches[0]!.number, "5А");
    assert.deepEqual(codesOf(fresh, QUESTION_TYPES.cutScene), ["сцена-вырезать:5:ИНТ. КУХНЯ — ДЕНЬ"]);
  });

  test("поменялись подобъект, режим или ИНТ/НАТ при том же объекте — совпадение без вопроса", () => {
    for (const heading of ["5. ИНТ. КУХНЯ. УГОЛ — ДЕНЬ", "5. ИНТ. КУХНЯ — НОЧЬ", "5. НАТ. КУХНЯ — ДЕНЬ"]) {
      const result = run(p(heading) + p("Тут."), existing);
      assert.deepEqual(codesOf(result, QUESTION_TYPES.sameScene), [], heading);
      assert.equal(result.sceneMatches[0]!.existingId, "k", heading);
      assert.equal(result.sceneMatches[0]!.pending, false, heading);
    }
  });

  test("шапка точно как у другой сцены проекта — вопрос с вариантом «это сцена 6»", () => {
    const body = p("5. НАТ. ДВОР — НОЧЬ") + p("Двор.");
    const result = run(body, existing);
    const code = "та-же-сцена:5:НАТ. ДВОР — НОЧЬ";
    const q = result.questions.find((x) => x.code === code);
    assert.ok(q);
    assert.deepEqual(q.options, ["same", "scene:y", "new"]);
    const other = run(body, existing, { [code]: "scene:y" });
    assert.equal(other.sceneMatches[0]!.existingId, "y");
    assert.equal(other.sceneMatches[0]!.number, "6");
    assert.deepEqual(codesOf(other, QUESTION_TYPES.cutScene), ["сцена-вырезать:5:ИНТ. КУХНЯ — ДЕНЬ"]);
  });

  test("другая сцена с той же шапкой сама есть в файле — вопроса нет", () => {
    const body = p("5. ИНТ. КУХНЯ — ДЕНЬ") + p("Раз.") + p("6. НАТ. ДВОР — НОЧЬ") + p("Два.");
    const result = run(body, existing);
    assert.deepEqual(codesOf(result, QUESTION_TYPES.sameScene), []);
    assert.deepEqual(
      result.sceneMatches.map((m) => m.existingId),
      ["k", "y"],
    );
  });
});

describe("вопросы, где предложенный ответ создаёт запись, — обязательные (решение владельца после 6а)", () => {
  const typing = () =>
    classifyParagraphs(readDocxParagraphs(readFileSync(path.join(FIXTURES, "ddct.docx"))));
  const EMPTY: ExistingRecords = { characters: [], locations: [], scenes: [] };

  test("ddct: без ответов импорт нельзя; «Подтвердить все» — можно; повтор со словарём — вопросов нет", () => {
    const first = normalizeScript(typing(), {}, { existing: EMPTY });
    const required = first.questions.filter((q) => q.required).map((q) => q.type).sort();
    assert.deepEqual(required, [
      QUESTION_TYPES.characterDigit,
      QUESTION_TYPES.similarCharacters,
      ...Array(4).fill(QUESTION_TYPES.similarLocations),
      ...Array(2).fill(QUESTION_TYPES.notScene),
    ].sort());
    // Предложенный вариант есть, но он не считается ответом.
    assert.ok(first.questions.filter((q) => q.required).every((q) => q.answer && !q.confirmed));
    assert.equal(blockingQuestions(first), 8);

    const answers = confirmAll(first);
    const confirmed = normalizeScript(typing(), answers, { existing: EMPTY });
    assert.equal(blockingQuestions(confirmed), 0);
    // СТАЖЕР1 подтверждён «оставить» — отдельный персонаж.
    assert.equal(confirmed.characters.length, 12);
    assert.ok(confirmed.characters.some((c) => c.name === "СТАЖЕР1"));

    // Словарь из подтверждённых ответов: новых записей ещё нет, цели «по имени» → id.
    const drafts = planImport(confirmed, answers, EMPTY, TIMING).rules;
    assert.equal(drafts.length, 8);
    const records = {
      characters: confirmed.characters.map((c) => ({ id: `c:${c.key}`, name: c.name })),
      locations: confirmed.locations.map((l) => ({ id: `l:${l.key}`, name: l.object, sublocation: null })),
    };
    const dictionary = drafts.map((d) => ({
      ...d,
      target:
        d.target && "name" in d.target
          ? { kind: d.target.kind, id: `${d.target.kind === "character" ? "c" : "l"}:${d.target.name}` }
          : d.target,
    }));
    const again = normalizeScript(typing(), {}, {
      dictionary,
      existing: { ...records, scenes: [] },
    });
    assert.deepEqual(
      again.questions.filter((q) => q.persistent).map((q) => q.code),
      [],
    );
    assert.equal(blockingQuestions(again), 0);
  });

  test("draft: «два объекта» (сц. 9) и похожие объекты — обязательные", () => {
    const draft = normalizeScript(
      classifyParagraphs(
        readDocxParagraphs(readFileSync(path.join(FIXTURES, "moya-malenkaya-draft.docx"))),
      ),
      {},
      { existing: EMPTY },
    );
    const objects = draft.questions.find((q) => q.type === QUESTION_TYPES.objects);
    assert.ok(objects?.required);
    assert.ok(
      draft.questions
        .filter((q) => q.type === QUESTION_TYPES.similarLocations)
        .every((q) => q.required),
    );
  });
});

describe("сопоставление через текущую версию", () => {
  const K = "ИНТ. КОМНАТА — ДЕНЬ";
  const Y = "НАТ. ДВОР — НОЧЬ";
  const locations = [
    { id: "l-room", name: "КОМНАТА", sublocation: null },
    { id: "l-yard", name: "ДВОР", sublocation: null },
  ];
  // v1: 1 и 2 — одинаковые шапки, 3 — двор, 4 — снова комната.
  const v1 = [K, K, Y, K];
  const scenes = v1.map((heading, i) =>
    scene({
      id: `v1-${i + 1}`,
      number: String(i + 1),
      heading: `${i + 1}. ${heading}`,
      intExt: heading === Y ? "EXT" : "INT",
      locationIds: [heading === Y ? "l-yard" : "l-room"],
    }),
  );
  const versionScenes = v1.map((heading, i) => ({
    sceneId: `v1-${i + 1}`,
    number: String(i + 1),
    key: headingKey(heading),
  }));
  const shifted = v1.map((heading, i) => p(`${i + 2}. ${heading}`) + p(`Текст ${i + 1}.`)).join("");

  test("номера сдвинуты на 1 — все сцены совпали через версию, без вопросов", () => {
    const result = run(shifted, { characters: [], locations, scenes, versionScenes });
    assert.deepEqual(
      result.sceneMatches.map((m) => m.existingId),
      ["v1-1", "v1-2", "v1-3", "v1-4"],
    );
    assert.ok(result.sceneMatches.every((m) => m.by === "version"));
    // Номера в либретто не меняются.
    assert.deepEqual(result.sceneMatches.map((m) => m.number), ["1", "2", "3", "4"]);
    assert.deepEqual(result.questions.map((q) => q.code), []);
    assert.deepEqual(result.missingScenes, []);
  });

  test("текущей версии нет — как раньше: по номеру проекта, вопрос при смене объекта", () => {
    const without = run(shifted, { characters: [], locations, scenes });
    const empty = run(shifted, { characters: [], locations, scenes, versionScenes: [] });
    assert.deepEqual(empty.sceneMatches, without.sceneMatches);
    assert.deepEqual(empty.questions.map((q) => q.code), without.questions.map((q) => q.code));
    // Без версии сдвиг виден только вопросами: файл 2 и 3 — шапка как у сцены 1 проекта
    // (её номера нет в файле), файл 4 — объект сменился (комната → двор).
    assert.deepEqual(codesOf(without, QUESTION_TYPES.sameScene), [
      `та-же-сцена:2:${K}`,
      `та-же-сцена:3:${K}`,
      `та-же-сцена:4:${Y}`,
    ]);
    assert.ok(without.sceneMatches.slice(0, 3).every((m) => m.by === "number" && m.pending));
  });

  test("шапка версии ссылается на удалённую или чужую сцену — путь по проекту", () => {
    const ghost = versionScenes.map((v) => ({ ...v, sceneId: `чужая-${v.sceneId}` }));
    const result = run(shifted, { characters: [], locations, scenes, versionScenes: ghost });
    const without = run(shifted, { characters: [], locations, scenes });
    assert.deepEqual(result.sceneMatches, without.sceneMatches);
  });

  test("две шапки версии на одну сцену — сцену получает первая, вторая идёт путём по проекту", () => {
    const body = p(`1. ${K}`) + p("Раз.") + p(`2. ${Y}`) + p("Два.");
    const twice = [
      { sceneId: "v1-1", number: "1", key: headingKey(K) },
      { sceneId: "v1-1", number: "2", key: headingKey(Y) },
    ];
    const result = run(body, { characters: [], locations, scenes, versionScenes: twice });
    assert.equal(result.sceneMatches[0]!.existingId, "v1-1");
    assert.equal(result.sceneMatches[0]!.by, "version");
    // Вторая: сцена 2 проекта по номеру; объект другой (комната → двор) — вопрос.
    assert.equal(result.sceneMatches[1]!.existingId, "v1-2");
    assert.equal(result.sceneMatches[1]!.by, "number");
    assert.deepEqual(codesOf(result, QUESTION_TYPES.sameScene), [`та-же-сцена:2:${Y}`]);
  });

  test("ответ «новая сцена» в прошлом импорте (файл 1 → проект 1А) — вопрос не повторяется", () => {
    const existing: ExistingRecords = {
      characters: [],
      locations: [{ id: "loc-test", name: "ТЕСТ ЛОКАЦИЯ", sublocation: null }],
      scenes: [
        scene({ id: "t1", number: "1", heading: "ТЕСТ ЛОКАЦИЯ", locationIds: ["loc-test"] }),
        scene({ id: "t1a", number: "1А", heading: "1. ЗАКАДРОВЫЙ ГОЛОС" }),
      ],
      versionScenes: [{ sceneId: "t1a", number: "1", key: headingKey("1. ЗАКАДРОВЫЙ ГОЛОС") }],
    };
    // Шапка без ИНТ/НАТ — сцена только по стилю Word (как в ddct).
    const docx = buildDocx({
      body: p("1. ЗАКАДРОВЫЙ ГОЛОС", "SceneHeading") + p("Голос."),
      styles: '<w:style w:type="paragraph" w:styleId="SceneHeading"><w:name w:val="Scene Heading"/></w:style>',
    });
    const result = normalizeScript(
      classifyParagraphs(readDocxParagraphs(docx)),
      { "шапка-не-сцена:ЗАКАДРОВЫЙ ГОЛОС": "scene" },
      { existing },
    );
    assert.equal(result.sceneMatches[0]!.existingId, "t1a");
    assert.equal(result.sceneMatches[0]!.by, "version");
    assert.deepEqual(codesOf(result, QUESTION_TYPES.sameScene), []);
    // Сцена 1 проекта — «нет в новой версии», как и после прошлого импорта.
    assert.deepEqual(result.missingScenes.map((m) => m.existingId), ["t1"]);
  });
});

describe("план записи", () => {
  test("номер с буквой — номер и буква отдельно", () => {
    assert.deepEqual(splitSceneNumber("11А"), { number: "11", postfix: "А" });
    assert.deepEqual(splitSceneNumber("7"), { number: "7", postfix: "" });
  });

  test("порядок по новой версии, сцены проекта без пары — после предыдущей", () => {
    const existing: ExistingRecords = {
      characters: [],
      locations: [],
      scenes: [
        scene({ id: "a", number: "1", heading: "ИНТ. А — ДЕНЬ" }),
        scene({ id: "b", number: "2", heading: "ИНТ. Б — ДЕНЬ" }),
        scene({ id: "c", number: "3", heading: "ИНТ. В — ДЕНЬ" }),
      ],
    };
    const body =
      p("1. ИНТ. А — ДЕНЬ") + p("Раз.") + p("1А. ИНТ. Н — ДЕНЬ") + p("Новая.") + p("3. ИНТ. В — ДЕНЬ") + p("Три.");
    const result = run(body, existing);
    const plan = planImport(result, {}, existing, TIMING);
    const order = [
      ...plan.scenes.map((s) => ({ id: s.existingId ?? `new:${s.number}${s.postfix}`, at: s.sortOrder })),
      ...plan.missing.map((m) => ({ id: m.id, at: m.sortOrder })),
    ]
      .sort((x, y) => x.at - y.at)
      .map((x) => x.id);
    // «Б» нет в файле: встаёт сразу после «А» — своей предыдущей по старому порядку.
    assert.deepEqual(order, ["a", "b", "new:1А", "c"]);
    // Хронометраж — только у новой сцены; текст сцены — у всех из файла.
    assert.equal(plan.scenes[0]!.planSeconds, null);
    assert.ok((plan.scenes[1]!.planSeconds ?? 0) > 0);
    assert.equal(plan.scenes[0]!.scriptContent, "Раз.");
  });

  test("ddct в «ТЕСТ импорт»: 2 — «вернуть?», 1, 3, 4 — «та же сцена?» (объект другой)", () => {
    const typing = classifyParagraphs(readDocxParagraphs(readFileSync(path.join(FIXTURES, "ddct.docx"))));
    const first = normalizeScript(typing, {}, { existing: TEST_PROJECT });
    const restore = first.questions.find((q) => q.type === QUESTION_TYPES.restoreScene);
    assert.ok(restore, "нет вопроса «вернуть?» по сцене 2");
    assert.equal(restore.scene, "2");
    const same = first.questions.filter((q) => q.type === QUESTION_TYPES.sameScene);
    assert.deepEqual(same.map((q) => q.scene), ["1", "3", "4"]);
    assert.ok(same.every((q) => q.required));
    // + 8 обязательных вопросов об именах (решение владельца после 6а).
    assert.equal(blockingQuestions(first), 4 + 8);

    const answers = {
      [restore.code]: "restore",
      ...Object.fromEntries(same.map((q) => [q.code, "same"])),
      ...confirmAll(first),
    };
    const result = normalizeScript(typing, answers, { existing: TEST_PROJECT });
    assert.equal(blockingQuestions(result), 0);
    const plan = planImport(result, answers, TEST_PROJECT, TIMING);
    const matched = plan.scenes.filter((s) => s.existingId).map((s) => s.existingId);
    // Сцена 1 файла — «ЗАКАДРОВЫЙ ГОЛОС», по умолчанию сцена: совпадает с ТЕСТ сценой 1.
    assert.deepEqual(matched, ["s1", "s2", "s3", "s4"]);
    assert.equal(plan.scenes.find((s) => s.existingId === "s2")!.restore, true);
    assert.equal(plan.scenes.filter((s) => !s.existingId).length, result.scenes.length - 4);
    assert.equal(plan.missing.length, 0);
    assert.equal(plan.characters.length, result.characters.length);
    assert.ok(plan.locations.length > 0);
    // Только текст, без разметки; титульной у ddct нет.
    assert.ok(plan.blocks.every((b) => !/<[a-z]/i.test(b.content)));
  });
});

describe("хронометраж совпавших сцен с новым текстом (шаг 7, решение владельца)", () => {
  const body =
    p("1. ИНТ. А — ДЕНЬ") +
    p("Новый текст сцены, заметно длиннее прежнего, чтобы хронометраж поменялся. ".repeat(20)) +
    p("2. ИНТ. Б — ДЕНЬ") +
    p("Два.");
  const typing = classifyParagraphs(readDocxParagraphs(buildDocx({ body })));
  const project = (planSeconds: number | null): ExistingRecords => ({
    characters: [],
    locations: [],
    scenes: [
      scene({ id: "a", number: "1", heading: "ИНТ. А — ДЕНЬ", contentHash: contentHash("Старый."), planSeconds }),
      // Текст сцены 2 не менялся — её хронометраж не трогается при любом значении.
      scene({ id: "b", number: "2", heading: "ИНТ. Б — ДЕНЬ", contentHash: contentHash("Два."), planSeconds: 7 }),
    ],
  });
  const timed = (
    existing: ExistingRecords,
    answers: Answers = {},
    timing: { mode: "PAGES" | "MANUAL"; pageToMinuteRatio: number } = TIMING,
  ) =>
    normalizeScript(typing, answers, { existing, timing });

  test("в либретто пусто — новый записывается без вопроса", () => {
    const existing = project(null);
    const result = timed(existing);
    assert.deepEqual(codesOf(result, QUESTION_TYPES.timing), []);
    assert.equal(result.timingUpdates.length, 1);
    assert.equal(result.timingUpdates[0]!.mode, "fill");
    const plan = planImport(result, {}, existing, TIMING);
    assert.equal(plan.scenes[0]!.planMode, "fill");
    assert.ok((plan.scenes[0]!.planSeconds ?? 0) > 0);
    assert.equal(plan.scenes[1]!.planMode, null);
    assert.equal(plan.scenes[1]!.planSeconds, null);
  });

  test("другой хронометраж — вопрос, по умолчанию «оставить»; «пересчитать» — записывается", () => {
    const existing = project(5);
    const result = timed(existing);
    const [question] = result.questions.filter((q) => q.type === QUESTION_TYPES.timing);
    assert.ok(question, "нет вопроса о хронометраже");
    assert.equal(question.scene, "1");
    assert.equal(question.required, false);
    assert.equal(question.suggested, "keep");
    assert.equal(question.persistent, false);
    assert.equal(blockingQuestions(result), 0);
    assert.deepEqual(result.timingUpdates, []);
    const kept = planImport(result, {}, existing, TIMING);
    assert.equal(kept.scenes[0]!.planMode, null);
    assert.equal(kept.scenes[0]!.planSeconds, null);

    const answers = { [question.code]: "recalc" };
    const recalc = timed(existing, answers);
    assert.equal(recalc.timingUpdates.length, 1);
    assert.equal(recalc.timingUpdates[0]!.mode, "set");
    const plan = planImport(recalc, answers, existing, TIMING);
    assert.equal(plan.scenes[0]!.planMode, "set");
    assert.equal(plan.scenes[0]!.planSeconds, recalc.timingUpdates[0]!.seconds);
    assert.notEqual(plan.scenes[0]!.planSeconds, 5);
  });

  test("тот же хронометраж — ни вопроса, ни записи", () => {
    const seconds = timed(project(null)).timingUpdates[0]!.seconds;
    const result = timed(project(seconds));
    assert.deepEqual(codesOf(result, QUESTION_TYPES.timing), []);
    assert.deepEqual(result.timingUpdates, []);
  });

  test("режим «вручную» — совпавшие сцены не трогаются, вопроса нет", () => {
    const manual = { mode: "MANUAL" as const, pageToMinuteRatio: 1 };
    for (const before of [null, 5]) {
      const existing = project(before);
      const result = timed(existing, {}, manual);
      assert.deepEqual(codesOf(result, QUESTION_TYPES.timing), []);
      assert.deepEqual(result.timingUpdates, []);
      const plan = planImport(result, {}, existing, manual);
      assert.ok(plan.scenes.every((s) => s.planMode === null && s.planSeconds === null));
    }
  });

  test("синхронизация с либретто — то же правило", () => {
    const existing = project(5);
    const result = normalizeScript(typing, {}, { existing, timing: TIMING, sync: true });
    assert.equal(codesOf(result, QUESTION_TYPES.timing).length, 1);
    assert.deepEqual(result.timingUpdates, []);
  });
});
