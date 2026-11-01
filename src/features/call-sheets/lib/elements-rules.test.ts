import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AUTO_ROW_NOT_FOUND,
  checkElementsSave,
  checkSectionsSave,
  DAY_NOT_FOUND,
  elementCounts,
  NO_RIGHTS,
  parseElementsPayload,
  planElementsSave,
  planSectionsSave,
  resolveSectionIds,
  sameElementRows,
  SECTION_NOT_FOUND,
  sectionHasRows,
  sectionRef,
  SPECIAL_TRANSPORT_MANUAL,
  systemSectionNotDeletable,
  type ElementsInProjectCheck,
  type ElementsPayload,
  type ExistingSection,
  type SectionsPayload,
} from "@/features/call-sheets/lib/elements-rules";
import {
  applyOverride,
  buildAutoRows,
  DEFAULT_CALL_SHEET_SECTIONS,
  effectiveSections,
  ensureSectionsIn,
  mergeAutoRows,
  overrideFromEdit,
  parseAutoKey,
  sectionForElement,
  sectionForResourceCategory,
  sectionForSceneResource,
  type AutoSourceScene,
  type SavedElement,
  type SectionsStore,
} from "@/features/call-sheets/lib/sections";

function scene(over: Partial<AutoSourceScene> = {}): AutoSourceScene {
  return {
    cutAt: null,
    episodeNumber: 0,
    number: "1",
    postfix: "",
    resources: [],
    elements: [],
    resourceItems: [],
    ...over,
  };
}

function saved(over: Partial<SavedElement> = {}): SavedElement {
  return {
    sectionId: "s-props",
    autoKey: null,
    hidden: false,
    name: "",
    quantity: null,
    scenes: null,
    arrivalTime: null,
    readyTime: null,
    wrapTime: null,
    notes: null,
    secondUnit: false,
    sortOrder: 0,
    ...over,
  };
}

const emptyValues = {
  name: "",
  quantity: "",
  scenes: "",
  arrivalTime: "",
  readyTime: "",
  wrapTime: "",
  notes: "",
  secondUnit: false,
};

/** Проверка проекта: «свои» id перечислены, остальное — чужое. Запоминает вызовы. */
function fakeInProject(own: string[]) {
  const calls: { entity: string; ids: string[] }[] = [];
  const check: ElementsInProjectCheck = async (entity, ids) => {
    calls.push({ entity, ids });
    return ids.every((id) => own.includes(id));
  };
  return { check, calls };
}

function existingSystem(): ExistingSection[] {
  return DEFAULT_CALL_SHEET_SECTIONS.map((s, index) => ({
    id: `s-${s.key}`,
    key: s.key,
    name: s.name,
    sortOrder: index,
    elementCount: 0,
  }));
}

function sectionsPayload(
  rows: { id?: string; key?: string; name: string }[],
  confirmedDeletes: string[] = [],
): SectionsPayload {
  return {
    sections: rows.map((row) => ({ id: row.id ?? "", key: row.key ?? "", name: row.name })),
    confirmedDeletes,
  };
}

function elementsPayload(over: Partial<ElementsPayload> = {}): ElementsPayload {
  return { autoEdits: [], keepOrphans: [], manual: [], ...over };
}

describe("соответствие типов разделам", () => {
  test("ресурсы либретто", () => {
    assert.equal(sectionForSceneResource("EXTRAS"), "GROUP");
    assert.equal(sectionForSceneResource("GROUP"), "GROUP");
    assert.equal(sectionForSceneResource("STUNT"), "STUNTS");
    assert.equal(sectionForSceneResource("PROP"), "PROPS");
    assert.equal(sectionForSceneResource("VEHICLE"), "GAME_TRANSPORT");
    assert.equal(sectionForSceneResource("COSTUME"), "COSTUME");
    assert.equal(sectionForSceneResource("CAMERA"), "CAMERA");
    assert.equal(sectionForSceneResource("MAKEUP"), null);
    assert.equal(sectionForSceneResource("CUSTOM"), null);
  });

  test("элементы разбора", () => {
    assert.equal(sectionForElement("PROP"), "PROPS");
    assert.equal(sectionForElement("VEHICLE"), "GAME_TRANSPORT");
    assert.equal(sectionForElement("WARDROBE"), "COSTUME");
    assert.equal(sectionForElement("COSTUME"), "COSTUME");
    assert.equal(sectionForElement("SFX"), null);
    assert.equal(sectionForElement("MAKEUP"), null);
    assert.equal(sectionForElement("OTHER"), null);
  });

  test("категории каталога — по словам в названии, посменные — без раздела", () => {
    const cat = (name: string, perShift = false) => sectionForResourceCategory({ name, perShift });
    assert.equal(cat("Групповка"), "GROUP");
    assert.equal(cat("Массовка"), "GROUP");
    assert.equal(cat("Игровой транспорт"), "GAME_TRANSPORT");
    assert.equal(cat("Реквизит"), "PROPS");
    assert.equal(cat("Костюмы"), "COSTUME");
    assert.equal(cat("Трюки"), "STUNTS");
    assert.equal(cat("Каскадёры"), "STUNTS");
    assert.equal(cat("Операторская техника"), "CAMERA");
    assert.equal(cat("Камеры"), "CAMERA");
    assert.equal(cat("CG"), "CG");
    assert.equal(cat("Компьютерная графика"), "CG");
    assert.equal(cat("Животные"), null);
    assert.equal(cat("Спецтранспорт"), null);
    assert.equal(cat("Операторская техника", true), null);
    assert.equal(cat("Групповка", true), null);
  });
});

describe("авто-строки из сцен дня", () => {
  test("одинаковое из разных сцен — одна строка: количество — сумма, сцены — список", () => {
    const rows = buildAutoRows([
      scene({
        number: "12",
        resources: [{ category: "GROUP", name: "Прохожие", quantity: 10 }],
        elements: [{ element: { id: "e1", type: "PROP", name: "Нож" } }],
        resourceItems: [
          {
            itemId: "i1",
            quantity: 2,
            item: { name: "Кран", category: { name: "Операторская техника", perShift: false } },
          },
        ],
      }),
      scene({
        number: "3",
        postfix: "А",
        episodeNumber: 2,
        resources: [
          { category: "EXTRAS", name: " прохожие ", quantity: 5 },
          { category: "MAKEUP", name: "Шрам", quantity: 1 },
        ],
        elements: [{ element: { id: "e1", type: "PROP", name: "Нож" } }],
        resourceItems: [
          {
            itemId: "i1",
            quantity: 1,
            item: { name: "Кран", category: { name: "Операторская техника", perShift: false } },
          },
        ],
      }),
      scene({ number: "4", resources: [{ category: "GROUP", name: "Прохожие", quantity: 1 }] }),
    ]);
    assert.deepEqual(rows, [
      { autoKey: "res:GROUP:прохожие", sectionKey: "GROUP", name: "Прохожие", quantity: "16", scenes: "2-3А, 4, 12" },
      { autoKey: "el:e1", sectionKey: "PROPS", name: "Нож", quantity: null, scenes: "2-3А, 12" },
      { autoKey: "item:i1", sectionKey: "CAMERA", name: "Кран", quantity: "3", scenes: "2-3А, 12" },
    ]);
  });

  test("вырезанная сцена строк не даёт", () => {
    const rows = buildAutoRows([
      scene({
        number: "5",
        cutAt: new Date("2026-10-01"),
        resources: [{ category: "STUNT", name: "Падение", quantity: 1 }],
        elements: [{ element: { id: "e2", type: "VEHICLE", name: "Такси" } }],
      }),
      scene({ number: "6", resources: [{ category: "PROP", name: "Чашка", quantity: 1 }] }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.autoKey),
      ["res:PROPS:чашка"],
    );
    assert.deepEqual(buildAutoRows([scene({ cutAt: new Date(), resources: [{ category: "PROP", name: "x", quantity: 1 }] })]), []);
  });

  test("ключи строк разбираются обратно", () => {
    assert.deepEqual(parseAutoKey("res:GROUP:прохожие"), { kind: "res", sectionKey: "GROUP", name: "прохожие" });
    assert.deepEqual(parseAutoKey("el:e1"), { kind: "el", id: "e1" });
    assert.deepEqual(parseAutoKey("item:i1"), { kind: "item", id: "i1" });
    assert.equal(parseAutoKey("x"), null);
  });
});

describe("правки авто-строк и «убрать из вызывного»", () => {
  const auto = { autoKey: "el:e1", sectionKey: "PROPS" as const, name: "Нож", quantity: "2", scenes: "1, 2" };

  test("правка перекрывает поля, пустые — из сцен", () => {
    assert.deepEqual(applyOverride(auto, null), {
      ...emptyValues,
      name: "Нож",
      quantity: "2",
      scenes: "1, 2",
    });
    const value = applyOverride(
      auto,
      saved({ autoKey: "el:e1", name: "Нож охотничий", arrivalTime: "08:00", secondUnit: true }),
    );
    assert.equal(value.name, "Нож охотничий");
    assert.equal(value.quantity, "2");
    assert.equal(value.scenes, "1, 2");
    assert.equal(value.arrivalTime, "08:00");
    assert.equal(value.secondUnit, true);
    // Явно очищенное количество — пусто, а не из сцен.
    assert.equal(applyOverride(auto, saved({ quantity: "" })).quantity, "");
  });

  test("hidden и правки строк, которых нет в сценах", () => {
    const merged = mergeAutoRows(
      [auto],
      [
        saved({ autoKey: "el:e1", hidden: true }),
        saved({ autoKey: "el:gone", notes: "было" }),
        saved({ name: "Ручная" }),
      ],
    );
    assert.equal(merged.rows.length, 1);
    assert.equal(merged.rows[0].hidden, true);
    assert.deepEqual(
      merged.orphans.map((row) => row.autoKey),
      ["el:gone"],
    );
  });

  test("правка из экрана: совпадает со сценами — не хранится", () => {
    const same = { ...applyOverride(auto, null), hidden: false };
    assert.equal(overrideFromEdit(auto, same), null);
    const hidden = overrideFromEdit(auto, { ...same, hidden: true });
    assert.deepEqual(hidden, {
      hidden: true,
      name: "",
      quantity: null,
      scenes: null,
      arrivalTime: null,
      readyTime: null,
      wrapTime: null,
      notes: null,
      secondUnit: false,
    });
    const edited = overrideFromEdit(auto, { ...same, quantity: "3", readyTime: "09:30" });
    assert.equal(edited?.quantity, "3");
    assert.equal(edited?.name, "");
    assert.equal(edited?.scenes, null);
    assert.equal(edited?.readyTime, "09:30");
  });
});

describe("разделы по умолчанию и ensure", () => {
  test("пока в базе разделов нет — разделы по умолчанию из кода", () => {
    const rows = effectiveSections([]);
    assert.deepEqual(
      rows.map((row) => [row.id, row.key, row.name]),
      DEFAULT_CALL_SHEET_SECTIONS.map((s) => [null, s.key, s.name]),
    );
    const partial = effectiveSections([
      { id: "x", key: null, name: "Животные" },
      { id: "g", key: "GROUP", name: "Массовка" },
    ]);
    assert.equal(partial.length, DEFAULT_CALL_SHEET_SECTIONS.length + 1);
    assert.deepEqual(partial.slice(0, 2).map((row) => row.name), ["Животные", "Массовка"]);
    assert.equal(sectionRef({ id: null, key: "CG" }), "key:CG");
    assert.equal(sectionRef({ id: "abc", key: "CG" }), "abc");
  });

  /** Фейк таблицы разделов с уникальностью [projectId, key]. */
  function fakeStore(initial: { projectId: string; key: string | null; sortOrder: number }[] = []) {
    const rows = [...initial];
    const store = (projectId: string): SectionsStore => ({
      listKeys: async () => rows.filter((row) => row.projectId === projectId),
      createManySkipDuplicates: async (data) => {
        let count = 0;
        for (const row of data) {
          if (rows.some((r) => r.projectId === row.projectId && r.key === row.key)) continue;
          rows.push(row);
          count += 1;
        }
        return count;
      },
    });
    return { rows, store };
  }

  test("создаёт недостающие, повторно — ничего", async () => {
    const { rows, store } = fakeStore();
    assert.equal(await ensureSectionsIn(store("p1"), "p1"), DEFAULT_CALL_SHEET_SECTIONS.length);
    assert.deepEqual(
      rows.map((row) => row.sortOrder),
      DEFAULT_CALL_SHEET_SECTIONS.map((_s, index) => index),
    );
    assert.equal(await ensureSectionsIn(store("p1"), "p1"), 0);
    assert.equal(rows.length, DEFAULT_CALL_SHEET_SECTIONS.length);
  });

  test("одновременный вызов — без дублей; свои разделы не трогает, новые — в конец", async () => {
    const { rows, store } = fakeStore([
      { projectId: "p1", key: null, sortOrder: 0 },
      { projectId: "p1", key: "GROUP", sortOrder: 4 },
      { projectId: "p2", key: null, sortOrder: 0 },
    ]);
    await Promise.all([ensureSectionsIn(store("p1"), "p1"), ensureSectionsIn(store("p1"), "p1")]);
    const p1 = rows.filter((row) => row.projectId === "p1");
    assert.equal(p1.length, DEFAULT_CALL_SHEET_SECTIONS.length + 1);
    assert.equal(new Set(p1.map((row) => row.key)).size, p1.length);
    assert.ok(p1.filter((row) => row.key && row.key !== "GROUP").every((row) => row.sortOrder >= 5));
    assert.equal(rows.filter((row) => row.projectId === "p2").length, 1);
  });
});

describe("сохранение разделов", () => {
  test("без права — отказ до базы", async () => {
    const { check, calls } = fakeInProject(["s1"]);
    const result = await checkSectionsSave(
      { canEdit: false, inProject: check },
      JSON.stringify(sectionsPayload([{ id: "s1", name: "Групповка" }])),
    );
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.equal(calls.length, 0);
  });

  test("чужой раздел — отказ", async () => {
    const { check, calls } = fakeInProject(["s1"]);
    const result = await checkSectionsSave(
      { canEdit: true, inProject: check },
      JSON.stringify(sectionsPayload([{ id: "s1", name: "А" }, { id: "foreign", name: "Б" }])),
    );
    assert.deepEqual(result, { error: SECTION_NOT_FOUND });
    assert.deepEqual(calls, [{ entity: "CallSheetSection", ids: ["s1", "foreign"] }]);
  });

  test("проверка полей: пустое и длинное название", async () => {
    const { check } = fakeInProject([]);
    const empty = await checkSectionsSave(
      { canEdit: true, inProject: check },
      JSON.stringify(sectionsPayload([{ name: "  " }])),
    );
    assert.deepEqual(empty, { error: "Укажите название раздела" });
    const long = await checkSectionsSave(
      { canEdit: true, inProject: check },
      JSON.stringify(sectionsPayload([{ name: "я".repeat(61) }])),
    );
    assert.ok("error" in long);
  });

  test("без разделов в базе: по умолчанию без правок — не изменение", () => {
    const plan = planSectionsSave(
      [],
      sectionsPayload(DEFAULT_CALL_SHEET_SECTIONS.map((s) => ({ key: s.key, name: s.name }))),
    );
    assert.ok(!("error" in plan));
    assert.equal(plan.changed, false);
    assert.equal(plan.creates.length, DEFAULT_CALL_SHEET_SECTIONS.length);
  });

  test("переименовать, передвинуть, добавить свой", () => {
    const existing = existingSystem();
    const rows = existing.map((row) => ({ id: row.id, name: row.name }));
    [rows[0], rows[1]] = [rows[1], { ...rows[0], name: "Массовка" }];
    const plan = planSectionsSave(existing, sectionsPayload([...rows, { name: "Животные" }]));
    assert.ok(!("error" in plan));
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.updates, [
      { id: "s-GAME_TRANSPORT", name: "Игровой транспорт", sortOrder: 0 },
      { id: "s-GROUP", name: "Массовка", sortOrder: 1 },
    ]);
    assert.deepEqual(plan.creates, [{ key: null, name: "Животные", sortOrder: 8 }]);
    assert.deepEqual(plan.deletes, []);
  });

  test("системный раздел нельзя удалить", () => {
    const existing = existingSystem();
    const rows = existing.filter((row) => row.key !== "CG").map((row) => ({ id: row.id, name: row.name }));
    assert.deepEqual(planSectionsSave(existing, sectionsPayload(rows)), {
      error: systemSectionNotDeletable("CG"),
    });
    // И системный из кода, которого ещё нет в базе.
    const fromCode = DEFAULT_CALL_SHEET_SECTIONS.filter((s) => s.key !== "PROPS").map((s) => ({
      key: s.key,
      name: s.name,
    }));
    assert.deepEqual(planSectionsSave([], sectionsPayload(fromCode)), {
      error: systemSectionNotDeletable("Реквизит"),
    });
  });

  test("свой раздел со строками — только с подтверждением", () => {
    const existing = [
      ...existingSystem(),
      { id: "own", key: null, name: "Животные", sortOrder: 8, elementCount: 3 },
    ];
    const rows = existingSystem().map((row) => ({ id: row.id, name: row.name }));
    assert.deepEqual(planSectionsSave(existing, sectionsPayload(rows)), {
      error: sectionHasRows("Животные", 3),
    });
    const plan = planSectionsSave(existing, sectionsPayload(rows, ["own"]));
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.deletes, [{ id: "own", name: "Животные", elementCount: 3 }]);
    assert.deepEqual(plan.audit.deleted, [{ name: "Животные", rows: 3 }]);
  });

  test("неизвестный ключ, дубль раздела и одинаковые названия — отказ", () => {
    const existing = existingSystem();
    const rows = existing.map((row) => ({ id: row.id, name: row.name }));
    assert.ok("error" in planSectionsSave(existing, sectionsPayload([...rows, { key: "HACK", name: "x" }])));
    assert.ok("error" in planSectionsSave(existing, sectionsPayload([...rows, { id: rows[0].id, name: "y" }])));
    assert.ok("error" in planSectionsSave(existing, sectionsPayload([...rows, { name: "реквизит" }])));
  });
});

describe("сохранение элементов площадки", () => {
  const manualRow = { ...emptyValues, section: "s-PROPS", name: "Зонт" };

  test("без права — отказ до базы", async () => {
    const { check, calls } = fakeInProject(["d1", "s-PROPS"]);
    const result = await checkElementsSave(
      { canEdit: false, inProject: check },
      "d1",
      JSON.stringify(elementsPayload({ manual: [manualRow] })),
    );
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.equal(calls.length, 0);
  });

  test("вызывной чужого дня (другого проекта) — отказ", async () => {
    const { check } = fakeInProject(["s-PROPS"]);
    const result = await checkElementsSave(
      { canEdit: true, inProject: check },
      "foreign-day",
      JSON.stringify(elementsPayload({ manual: [manualRow] })),
    );
    assert.deepEqual(result, { error: DAY_NOT_FOUND });
  });

  test("чужой раздел — отказ; системный по ключу — можно, спецтранспорт — нет", async () => {
    const { check, calls } = fakeInProject(["d1"]);
    const foreign = await checkElementsSave(
      { canEdit: true, inProject: check },
      "d1",
      JSON.stringify(elementsPayload({ manual: [{ ...manualRow, section: "foreign" }] })),
    );
    assert.deepEqual(foreign, { error: SECTION_NOT_FOUND });
    assert.deepEqual(calls.at(-1), { entity: "CallSheetSection", ids: ["foreign"] });

    const byKey = await checkElementsSave(
      { canEdit: true, inProject: check },
      "d1",
      JSON.stringify(elementsPayload({ manual: [{ ...manualRow, section: "key:CG" }] })),
    );
    assert.ok("data" in byKey);

    const special = await checkElementsSave(
      { canEdit: true, inProject: check },
      "d1",
      JSON.stringify(elementsPayload({ manual: [{ ...manualRow, section: "key:SPECIAL_TRANSPORT" }] })),
    );
    assert.deepEqual(special, { error: SPECIAL_TRANSPORT_MANUAL });
    const badKey = await checkElementsSave(
      { canEdit: true, inProject: check },
      "d1",
      JSON.stringify(elementsPayload({ manual: [{ ...manualRow, section: "key:HACK" }] })),
    );
    assert.deepEqual(badKey, { error: SECTION_NOT_FOUND });
  });

  test("проверка полей: время ЧЧ:ММ, длины, «что» у ручной строки", () => {
    const bad = (row: Record<string, unknown>) =>
      parseElementsPayload(JSON.stringify(elementsPayload({ manual: [{ ...manualRow, ...row }] as never })));
    assert.deepEqual(bad({ arrivalTime: "8:00" }), { error: "Время — в виде ЧЧ:ММ" });
    assert.deepEqual(bad({ wrapTime: "24:00" }), { error: "Время — в виде ЧЧ:ММ" });
    assert.ok("data" in bad({ readyTime: "23:59" }));
    assert.deepEqual(bad({ name: " " }), { error: "Укажите, что нужно на площадке" });
    assert.ok("error" in bad({ name: "я".repeat(201) }));
    assert.ok("error" in bad({ quantity: "1".repeat(41) }));
    assert.ok("error" in bad({ scenes: "1".repeat(301) }));
    assert.ok("error" in bad({ notes: "я".repeat(501) }));
    assert.deepEqual(parseElementsPayload("{"), { error: "Некорректные данные" });
  });

  const auto = { autoKey: "el:e1", sectionKey: "PROPS" as const, name: "Нож", quantity: null, scenes: "1" };
  const sections = existingSystem().map((row) => ({ id: row.id, key: row.key }));

  test("autoKey — только из авто-строк дня или сохранённых правок", () => {
    const edit = { ...applyOverride(auto, null), autoKey: "el:other", hidden: false };
    assert.deepEqual(
      planElementsSave({ autoRows: [auto], saved: [], sections, data: elementsPayload({ autoEdits: [edit] }) }),
      { error: AUTO_ROW_NOT_FOUND },
    );
    // Строка ушла из сцен, а правка сохранена — оставляем как есть.
    const kept = saved({ autoKey: "el:other", sectionId: "s-PROPS", notes: "важно" });
    const plan = planElementsSave({
      autoRows: [auto],
      saved: [kept],
      sections,
      data: elementsPayload({ autoEdits: [edit] }),
    });
    assert.ok("rows" in plan);
    assert.equal(plan.rows.length, 1);
    assert.equal(plan.rows[0].notes, "важно");
  });

  test("правки, убранные строки, правки без сцен и ручные — в запись", () => {
    const orphan = saved({ autoKey: "el:gone", sectionId: "s-PROPS", notes: "x" });
    const dropped = saved({ autoKey: "el:gone2", sectionId: "s-PROPS", notes: "y" });
    const plan = planElementsSave({
      autoRows: [auto, { ...auto, autoKey: "el:e2", name: "Вилка" }],
      saved: [orphan, dropped],
      sections,
      data: elementsPayload({
        autoEdits: [
          { ...applyOverride(auto, null), autoKey: "el:e1", hidden: true },
          { ...applyOverride(auto, null), name: "Вилка", autoKey: "el:e2", hidden: false },
        ],
        keepOrphans: ["el:gone", "el:unknown"],
        manual: [
          { ...manualRow, section: "key:CG", name: "Дракон", arrivalTime: "07:00" },
          { ...manualRow, name: "Зонт", secondUnit: true },
        ],
      }),
    });
    assert.ok("rows" in plan);
    assert.deepEqual(
      plan.rows.map((row) => [row.autoKey, row.hidden, row.name, row.section, row.sortOrder]),
      [
        ["el:e1", true, "", { key: "PROPS" }, 0],
        ["el:gone", false, "", { id: "s-PROPS" }, 0],
        [null, false, "Дракон", { key: "CG" }, 0],
        [null, false, "Зонт", { id: "s-PROPS" }, 1],
      ],
    );
    assert.deepEqual(elementCounts(plan.rows), { manual: 2, edits: 1, hidden: 1 });

    const resolved = resolveSectionIds(plan.rows, sections);
    assert.ok("rows" in resolved);
    assert.equal(resolved.rows[2].sectionId, "s-CG");
    assert.deepEqual(resolveSectionIds(plan.rows, sections.filter((s) => s.key !== "CG")), {
      error: SECTION_NOT_FOUND,
    });
    assert.equal(sameElementRows(resolved.rows, [...resolved.rows].reverse()), true);
    assert.equal(sameElementRows(resolved.rows, resolved.rows.slice(1)), false);
  });

  test("ручная строка в разделе спецтранспорта или чужом разделе — отказ", () => {
    const data = (section: string) => elementsPayload({ manual: [{ ...manualRow, section }] });
    assert.deepEqual(
      planElementsSave({ autoRows: [], saved: [], sections, data: data("s-SPECIAL_TRANSPORT") }),
      { error: SPECIAL_TRANSPORT_MANUAL },
    );
    assert.deepEqual(planElementsSave({ autoRows: [], saved: [], sections, data: data("foreign") }), {
      error: SECTION_NOT_FOUND,
    });
  });
});
