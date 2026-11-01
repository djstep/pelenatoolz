import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  CATEGORY_DEFAULT_NAMES,
  defaultSectionKeyForCategory,
  DEFAULT_CALL_SHEET_SECTIONS,
  effectiveSections,
  ensureSectionsIn,
  mergeAutoRows,
  overrideFromEdit,
  parseAutoKey,
  placeMissingSections,
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
    // «Своё» — в «Прочее».
    assert.equal(sectionForSceneResource("MAKEUP"), "MAKEUP");
    assert.equal(sectionForSceneResource("CUSTOM"), "OTHER");
  });

  test("элементы разбора", () => {
    assert.equal(sectionForElement("PROP"), "PROPS");
    assert.equal(sectionForElement("VEHICLE"), "GAME_TRANSPORT");
    assert.equal(sectionForElement("WARDROBE"), "COSTUME");
    assert.equal(sectionForElement("COSTUME"), "COSTUME");
    assert.equal(sectionForElement("SFX"), "SFX");
    assert.equal(sectionForElement("MAKEUP"), "MAKEUP");
    assert.equal(sectionForElement("OTHER"), "OTHER");
  });

  test("позиция каталога (и посменная) — раздел из настройки категории, не выбран — «Прочее»", () => {
    const cat = (callSheetSection: { id: string; key: string | null } | null) =>
      sectionForResourceCategory({ callSheetSection });
    assert.deepEqual(cat({ id: "s-cam", key: "CAMERA" }), { id: "s-cam" });
    assert.deepEqual(cat({ id: "s-own", key: null }), { id: "s-own" });
    assert.deepEqual(cat(null), { key: "OTHER" });
    // Спецтранспорт правится в своём блоке — позиции каталога туда не идут.
    assert.deepEqual(cat({ id: "s-st", key: "SPECIAL_TRANSPORT" }), { key: "OTHER" });
  });

  test("раздел по умолчанию для новой категории — только точное название", () => {
    const def = (name: string) => defaultSectionKeyForCategory({ name });
    assert.equal(def("Групповка"), "GROUP");
    assert.equal(def("  МАССОВКА "), "GROUP");
    assert.equal(def("Игровой транспорт"), "GAME_TRANSPORT");
    assert.equal(def("Реквизит"), "PROPS");
    assert.equal(def("Костюмы"), "COSTUME");
    assert.equal(def("Каскадёры"), "STUNTS");
    assert.equal(def("Операторская  техника"), "CAMERA");
    assert.equal(def("Опер. техника"), "CAMERA");
    assert.equal(def("CG"), "CG");
    assert.equal(def("Грим"), "MAKEUP");
    assert.equal(def("Спецэффекты"), "SFX");
    // Не по части слова.
    assert.equal(def("Пиротехника"), null);
    assert.equal(def("Светотехника"), null);
    assert.equal(def("Доп. техника"), null);
    assert.equal(def("Транспорт группы"), null);
    assert.equal(def("Спецтранспорт"), null);
    assert.equal(def("Реквизит (аренда)"), null);
  });

  test("каждая пара миграции данных есть в коде (миграция уже применена — не меняется)", () => {
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261101140300_resource_category_call_sheet_section/migration.sql",
      ),
      "utf8",
    );
    const pairs = [...sql.matchAll(/\('([^']+)', '([A-Z_]+)'\)/g)].map((m) => [m[1]!, m[2]!]);
    assert.ok(pairs.length > 0);
    const code = CATEGORY_DEFAULT_NAMES as Record<string, readonly string[]>;
    for (const [name, key] of pairs) {
      assert.ok(code[key]?.includes(name), `в коде нет ${name} → ${key}`);
    }
  });
});

const noTimes = { arrivalTime: null, readyTime: null, wrapTime: null };

describe("авто-строки из сцен дня", () => {
  test("одинаковое из разных сцен — одна строка: количество — наибольшее, сцены — список", () => {
    const camera = { id: "s-cam", key: "CAMERA" };
    const rows = buildAutoRows([
      scene({
        number: "12",
        resources: [{ category: "GROUP", name: "Прохожие", quantity: 10 }],
        elements: [{ element: { id: "e1", type: "PROP", name: "Нож" } }],
        resourceItems: [
          {
            itemId: "i1",
            quantity: 2,
            item: { name: "Кран", category: { callSheetSection: camera } },
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
            item: { name: "Кран", category: { callSheetSection: camera } },
          },
          {
            itemId: "i2",
            quantity: 1,
            item: { name: "Дым-машина", category: { callSheetSection: null } },
          },
        ],
      }),
      scene({ number: "4", resources: [{ category: "GROUP", name: "Прохожие", quantity: 1 }] }),
    ]);
    assert.deepEqual(rows, [
      // 10, 5 и 1 человек в трёх сценах — это не 16, а не больше 10.
      { autoKey: "res:GROUP:прохожие", section: { key: "GROUP" }, name: "Прохожие", quantity: "10", scenes: "2-3А, 4, 12", ...noTimes },
      { autoKey: "el:e1", section: { key: "PROPS" }, name: "Нож", quantity: null, scenes: "2-3А, 12", ...noTimes },
      { autoKey: "res:MAKEUP:шрам", section: { key: "MAKEUP" }, name: "Шрам", quantity: "1", scenes: "2-3А", ...noTimes },
      { autoKey: "item:i2", section: { key: "OTHER" }, name: "Дым-машина", quantity: "1", scenes: "2-3А", ...noTimes },
      // Раздел проекта по id — после системных.
      { autoKey: "item:i1", section: { id: "s-cam" }, name: "Кран", quantity: "2", scenes: "2-3А, 12", ...noTimes },
    ]);
  });

  test("SFX — «Спецэффекты», грим (элемент и ресурс) — «Грим»", () => {
    const rows = buildAutoRows([
      scene({
        number: "7",
        resources: [{ category: "MAKEUP", name: "Шрам", quantity: 1 }],
        elements: [
          { element: { id: "e-sfx", type: "SFX", name: "Взрыв" } },
          { element: { id: "e-mk", type: "MAKEUP", name: "Синяк" } },
        ],
      }),
    ]);
    assert.deepEqual(
      rows.map((row) => [row.name, row.section]),
      [
        ["Синяк", { key: "MAKEUP" }],
        ["Шрам", { key: "MAKEUP" }],
        ["Взрыв", { key: "SFX" }],
      ],
    );
  });

  test("посменные ресурсы дня — строки в разделе своей категории, с временем подачи", () => {
    const rows = buildAutoRows(
      [
        scene({
          number: "1",
          resourceItems: [
            {
              itemId: "gen",
              quantity: 1,
              item: { name: "Генератор", category: { callSheetSection: { id: "s-cam", key: "CAMERA" } } },
            },
          ],
        }),
      ],
      [
        {
          itemId: "gen",
          arrivalTime: "06:30",
          readyTime: "07:00",
          wrapTime: null,
          item: { name: "Генератор", category: { callSheetSection: { id: "s-cam", key: "CAMERA" } } },
        },
        {
          itemId: "bus",
          arrivalTime: "06:00",
          readyTime: null,
          wrapTime: "20:00",
          item: { name: "Доп. автобус", category: { callSheetSection: null } },
        },
      ],
    );
    assert.deepEqual(rows, [
      {
        autoKey: "item:bus",
        section: { key: "OTHER" },
        name: "Доп. автобус",
        quantity: null,
        scenes: "",
        arrivalTime: "06:00",
        readyTime: null,
        wrapTime: "20:00",
      },
      // Тот же ресурс и в сцене, и посменно — одна строка: сцены из сцен, время из дня.
      {
        autoKey: "item:gen",
        section: { id: "s-cam" },
        name: "Генератор",
        quantity: "1",
        scenes: "1",
        arrivalTime: "06:30",
        readyTime: "07:00",
        wrapTime: null,
      },
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
  const auto = { autoKey: "el:e1", section: { key: "PROPS" as const }, name: "Нож", quantity: "2", scenes: "1, 2", ...noTimes };

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
  test("порядок по умолчанию: «Грим» после «Костюма», «Спецэффекты» после «Трюков», «Прочее» последний", () => {
    assert.deepEqual(
      DEFAULT_CALL_SHEET_SECTIONS.map((s) => s.name),
      [
        "Групповка",
        "Игровой транспорт",
        "Реквизит",
        "Костюм",
        "Грим",
        "Трюки",
        "Спецэффекты",
        "Опер. техника",
        "CG",
        "Спецтранспорт",
        "Прочее",
      ],
    );
  });

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
    // Свой раздел — на своём месте, недостающие системные — после «Массовки», «Прочее» — в конце.
    assert.deepEqual(partial.slice(0, 3).map((row) => row.name), ["Животные", "Массовка", "Игровой транспорт"]);
    assert.equal(partial.at(-1)!.key, "OTHER");
    assert.equal(sectionRef({ id: null, key: "CG" }), "key:CG");
    assert.equal(sectionRef({ id: "abc", key: "CG" }), "abc");
  });

  test("проекту с прежними 9 разделами новые встают на свои места, открытие ничего не пишет", () => {
    const old = ["GROUP", "GAME_TRANSPORT", "PROPS", "COSTUME", "STUNTS", "CAMERA", "CG", "SPECIAL_TRANSPORT", "OTHER"];
    const rows = effectiveSections(old.map((key) => ({ id: key, key, name: key })));
    assert.deepEqual(
      rows.map((row) => [row.key, row.id]),
      [
        ["GROUP", "GROUP"],
        ["GAME_TRANSPORT", "GAME_TRANSPORT"],
        ["PROPS", "PROPS"],
        ["COSTUME", "COSTUME"],
        ["MAKEUP", null],
        ["STUNTS", "STUNTS"],
        ["SFX", null],
        ["CAMERA", "CAMERA"],
        ["CG", "CG"],
        ["SPECIAL_TRANSPORT", "SPECIAL_TRANSPORT"],
        ["OTHER", "OTHER"],
      ],
    );
  });

  test("разделы переставляли — новые встают после своего предыдущего, «Прочее» — в конец", () => {
    const placed = placeMissingSections([
      { key: "COSTUME" },
      { key: null },
      { key: "GROUP" },
    ]);
    assert.deepEqual(
      placed.map((item) => ("row" in item ? (item.row.key ?? "своё") : `+${item.missing.key}`)),
      [
        "COSTUME",
        "+MAKEUP",
        "+STUNTS",
        "+SFX",
        "+CAMERA",
        "+CG",
        "+SPECIAL_TRANSPORT",
        "своё",
        "GROUP",
        "+GAME_TRANSPORT",
        "+PROPS",
        "+OTHER",
      ],
    );
  });

  /** Фейк таблицы разделов с уникальностью [projectId, key]. */
  function fakeStore(
    initial: { id: string; projectId: string; key: string | null; sortOrder: number }[] = [],
  ) {
    const rows = [...initial];
    let nextId = 0;
    const store = (projectId: string): SectionsStore => ({
      list: async () =>
        rows.filter((row) => row.projectId === projectId).sort((a, b) => a.sortOrder - b.sortOrder),
      createManySkipDuplicates: async (data) => {
        let count = 0;
        for (const row of data) {
          if (rows.some((r) => r.projectId === row.projectId && r.key === row.key)) continue;
          rows.push({ ...row, id: `new${nextId++}` });
          count += 1;
        }
        return count;
      },
      setSortOrders: async (data) => {
        for (const change of data) {
          const row = rows.find((r) => r.id === change.id);
          if (row) row.sortOrder = change.sortOrder;
        }
      },
    });
    const order = (projectId: string) =>
      rows
        .filter((row) => row.projectId === projectId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => row.key);
    return { rows, store, order };
  }

  test("создаёт недостающие, повторно — ничего", async () => {
    const { rows, store, order } = fakeStore();
    assert.equal(await ensureSectionsIn(store("p1"), "p1"), DEFAULT_CALL_SHEET_SECTIONS.length);
    assert.deepEqual(order("p1"), DEFAULT_CALL_SHEET_SECTIONS.map((s) => s.key));
    assert.equal(await ensureSectionsIn(store("p1"), "p1"), 0);
    assert.equal(rows.length, DEFAULT_CALL_SHEET_SECTIONS.length);
  });

  test("существующему проекту «Грим» и «Спецэффекты» добавляются на свои места", async () => {
    const old = ["GROUP", "GAME_TRANSPORT", "PROPS", "COSTUME", "STUNTS", "CAMERA", "CG", "SPECIAL_TRANSPORT", "OTHER"];
    const { store, order } = fakeStore(
      old.map((key, index) => ({ id: key, projectId: "p1", key, sortOrder: index })),
    );
    assert.equal(await ensureSectionsIn(store("p1"), "p1"), 2);
    assert.deepEqual(order("p1"), DEFAULT_CALL_SHEET_SECTIONS.map((s) => s.key));
  });

  test("одновременный вызов — без дублей; свои разделы остаются, чужой проект не трогается", async () => {
    const { rows, store, order } = fakeStore([
      { id: "own", projectId: "p1", key: null, sortOrder: 0 },
      { id: "g", projectId: "p1", key: "GROUP", sortOrder: 4 },
      { id: "other", projectId: "p2", key: null, sortOrder: 0 },
    ]);
    await Promise.all([ensureSectionsIn(store("p1"), "p1"), ensureSectionsIn(store("p1"), "p1")]);
    const p1 = rows.filter((row) => row.projectId === "p1");
    assert.equal(p1.length, DEFAULT_CALL_SHEET_SECTIONS.length + 1);
    assert.equal(new Set(p1.map((row) => row.key)).size, p1.length);
    assert.deepEqual(order("p1").slice(0, 3), [null, "GROUP", "GAME_TRANSPORT"]);
    assert.equal(order("p1").at(-1), "OTHER");
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
    assert.deepEqual(plan.creates, [{ key: null, name: "Животные", sortOrder: DEFAULT_CALL_SHEET_SECTIONS.length }]);
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

  const auto = { autoKey: "el:e1", section: { key: "PROPS" as const }, name: "Нож", quantity: null, scenes: "1", ...noTimes };
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
