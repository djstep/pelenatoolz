import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { DEFAULT_BREAK_PRESETS, withMissingBuiltins } from "@/features/day-docs/lib/break-presets";
import { activeDayScenes, buildDayStats } from "@/features/day-docs/lib/build-day-doc";
import {
  computeActorTimingBaselines,
  computeResourceTimingBaselines,
} from "@/features/day-docs/lib/compute-call-timings";
import {
  buildPlanSlots,
  cascadeDayPlan,
  type DayPlanItem,
  type SecondUnitRow,
} from "@/features/day-docs/lib/compute-day-plan";
import {
  breakFieldsFromSlot,
  checkTimeSlotsSave,
  CONTINUATION_NEEDS_SCENE,
  cutSceneWarnings,
  describePlanSlot,
  parseTimeSlotRows,
  PLAN_SCENE_NOT_FOUND,
  type PlanRulesDeps,
  type PlanSceneFacts,
} from "@/features/day-docs/lib/plan-rules";

// id сцен — в виде cuid (схема строки плана проверяет формат).
const S1 = "cl00000000000000000000001";
const S2 = "cl00000000000000000000002";
const CUT = "cl00000000000000000000009";
const FOREIGN = "cl00000000000000000000099";

const projectScenes: PlanSceneFacts[] = [
  { id: S1, number: "1", postfix: "", episodeNumber: 0, cutAt: null },
  { id: S2, number: "2", postfix: "А", episodeNumber: 0, cutAt: null },
  { id: CUT, number: "7", postfix: "Б", episodeNumber: 0, cutAt: new Date("2026-10-30") },
];

/** Сцены проекта перечислены, остальное — чужое. Запоминает обращения к «базе». */
function fakeDeps(scenes: PlanSceneFacts[] = projectScenes) {
  const calls: { inProject: string[][]; loadScenes: string[][] } = { inProject: [], loadScenes: [] };
  const deps: PlanRulesDeps = {
    inProject: async (ids) => {
      calls.inProject.push(ids);
      return ids.every((id) => scenes.some((scene) => scene.id === id));
    },
    loadScenes: async (ids) => {
      calls.loadScenes.push(ids);
      return scenes.filter((scene) => ids.includes(scene.id));
    },
  };
  return { deps, calls };
}

function row(over: Record<string, unknown> = {}) {
  return { startTime: "09:00", endTime: "10:00", slotType: "SHOOTING", sceneId: null, notes: "", ...over };
}

describe("сохранение плана: проверки сервера", () => {
  test("вырезанная сцена в строке плана — отказ с номером сцены", async () => {
    const { deps } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([row({ sceneId: S1 }), row({ sceneId: CUT })]),
    );
    assert.deepEqual(result, { error: "Сцена 7Б вырезана — её нельзя поставить в план" });
  });

  test("вырезанная сцена в строке 2-го юнита — тоже отказ", async () => {
    const { deps } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([row({ sceneId: S1 }), row({ sceneId: CUT, unit: "SECOND" })]),
    );
    assert.deepEqual(result, { error: "Сцена 7Б вырезана — её нельзя поставить в план" });
  });

  test("вырезанная сцена-продолжение — отказ", async () => {
    const { deps } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([row({ sceneId: CUT, isContinuation: true })]),
    );
    assert.ok("error" in result && result.error.includes("вырезана"));
  });

  test("не вырезанные сцены проходят, поля строк — как переданы", async () => {
    const { deps } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([
        row({ sceneId: S1 }),
        row({ startTime: "13:00", endTime: "14:00", slotType: "LUNCH", customLabel: "Обед в кафе", notes: "  у входа " }),
        row({ startTime: "14:00", endTime: "", sceneId: S1, isContinuation: true }),
        row({ startTime: "11:00", sceneId: S2, unit: "SECOND", customLabel: "  " }),
      ]),
    );
    assert.ok("rows" in result);
    assert.deepEqual(result.rows, [
      { startTime: "09:00", endTime: "10:00", slotType: "SHOOTING", sceneId: S1, notes: null, unit: "MAIN", isContinuation: false, customLabel: null, sortOrder: 0 },
      { startTime: "13:00", endTime: "14:00", slotType: "LUNCH", sceneId: null, notes: "у входа", unit: "MAIN", isContinuation: false, customLabel: "Обед в кафе", sortOrder: 1 },
      { startTime: "14:00", endTime: null, slotType: "SHOOTING", sceneId: S1, notes: null, unit: "MAIN", isContinuation: true, customLabel: null, sortOrder: 2 },
      { startTime: "11:00", endTime: "10:00", slotType: "SHOOTING", sceneId: S2, notes: null, unit: "SECOND", isContinuation: false, customLabel: null, sortOrder: 3 },
    ]);
  });

  test("«продолжение сцены» без сцены — ошибка, база не трогается", async () => {
    const { deps, calls } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([row({ sceneId: S1 }), row({ slotType: "IDLE", isContinuation: true })]),
    );
    assert.deepEqual(result, { error: CONTINUATION_NEEDS_SCENE });
    assert.equal(calls.inProject.length, 0);
    assert.equal(calls.loadScenes.length, 0);
  });

  test("чужая сцена (не этого проекта) — отказ до чтения сцен", async () => {
    const { deps, calls } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([row({ sceneId: S1 }), row({ sceneId: FOREIGN, unit: "SECOND" })]),
    );
    assert.deepEqual(result, { error: PLAN_SCENE_NOT_FOUND });
    assert.deepEqual(calls.inProject, [[S1, FOREIGN]]);
    assert.equal(calls.loadScenes.length, 0);
  });

  test("строки без сцен — проверка проекта не нужна", async () => {
    const { deps, calls } = fakeDeps();
    const result = await checkTimeSlotsSave(deps, JSON.stringify([row({ slotType: "PREP" })]));
    assert.ok("rows" in result);
    assert.equal(result.rows[0]!.slotType, "PREP");
    assert.equal(calls.inProject.length, 0);
  });

  test("свой текст длиннее 200 знаков — ошибка", async () => {
    const { deps } = fakeDeps();
    const result = await checkTimeSlotsSave(
      deps,
      JSON.stringify([row({ slotType: "IDLE", customLabel: "я".repeat(201) })]),
    );
    assert.deepEqual(result, { error: "Свой текст строки плана — до 200 знаков" });
  });

  test("битый JSON — ошибка формата", async () => {
    const { deps } = fakeDeps();
    assert.deepEqual(await checkTimeSlotsSave(deps, "{"), { error: "Некорректный формат расписания" });
  });
});

describe("старые строки без новых полей", () => {
  test("разбираются с умолчаниями: основной юнит, не продолжение, без своего текста", () => {
    const result = parseTimeSlotRows(
      JSON.stringify([{ startTime: "08:00", endTime: "08:30", slotType: "MAKEUP_COSTUME", sceneId: null, notes: "Обед — в кафе" }]),
    );
    assert.ok("rows" in result);
    assert.equal(result.rows[0]!.unit, "MAIN");
    assert.equal(result.rows[0]!.isContinuation, false);
    assert.equal(result.rows[0]!.customLabel, null);
    assert.equal(result.rows[0]!.notes, "Обед — в кафе");
  });

  test("подпись, склеенная в notes, показывается как раньше", () => {
    const legacy = { slotType: "TRAVEL" as const, notes: "Переезд · Завод — ул. Ленина → пр. Мира", customLabel: null };
    assert.deepEqual(describePlanSlot(legacy), {
      title: "Переезд",
      notes: "Переезд · Завод — ул. Ленина → пр. Мира",
    });
    // В планере текст не теряется: подпись — тип, примечание — целиком.
    assert.deepEqual(breakFieldsFromSlot(legacy), {
      label: "Переезд",
      notes: "Переезд · Завод — ул. Ленина → пр. Мира",
    });
  });

  test("старая склейка «Название типа — примечание» разбирается без дубля названия", () => {
    assert.deepEqual(breakFieldsFromSlot({ slotType: "LUNCH", notes: "Обед", customLabel: null }), {
      label: "Обед",
      notes: "",
    });
    assert.deepEqual(breakFieldsFromSlot({ slotType: "LUNCH", notes: "Обед — в кафе", customLabel: null }), {
      label: "Обед",
      notes: "в кафе",
    });
  });

  test("новая строка: свой текст — из customLabel, «Продолжение сцены N»", () => {
    assert.deepEqual(breakFieldsFromSlot({ slotType: "IDLE", notes: "ждём свет", customLabel: "Ожидание" }), {
      label: "Ожидание",
      notes: "ждём свет",
    });
    assert.deepEqual(
      describePlanSlot({
        slotType: "SHOOTING",
        notes: null,
        isContinuation: true,
        scene: { number: "12", postfix: "А", episodeNumber: 0 },
      }),
      { title: "Продолжение сцены 12А", notes: null },
    );
    assert.equal(describePlanSlot({ slotType: "PREP", notes: null }).title, "Подготовка");
  });
});

describe("каскад основного юнита", () => {
  const items: DayPlanItem[] = [
    { kind: "scene", id: "a", assignmentId: "as1", sceneId: S1, label: "1", duration: "01:00" },
    { kind: "scene", id: "c", assignmentId: "as9", sceneId: CUT, label: "7Б", duration: "02:00" },
    { kind: "break", id: "b", slotType: "LUNCH", label: "Обед", duration: "01:00", notes: "" },
    { kind: "break", id: "p", slotType: "PREP", label: "Подготовка площадки", duration: "00:30", notes: " свет " },
    { kind: "scene", id: "a2", assignmentId: "as1", sceneId: S1, label: "Продолжение", duration: "00:30", isContinuation: true },
  ];

  test("вырезанные сцены пропускаются и время не занимают", () => {
    const slots = cascadeDayPlan("08:00", items, new Set([CUT]));
    assert.deepEqual(
      slots.map((s) => [s.startTime, s.endTime, s.slotType, s.sceneId]),
      [
        ["08:00", "09:00", "SHOOTING", S1],
        ["09:00", "10:00", "LUNCH", null],
        ["10:00", "10:30", "PREP", null],
        ["10:30", "11:00", "SHOOTING", S1],
      ],
    );
  });

  test("свой текст — в customLabel (а не в notes), продолжение помечено", () => {
    const slots = cascadeDayPlan("08:00", items, new Set([CUT]));
    assert.equal(slots[1]!.customLabel, null, "название типа не хранится как свой текст");
    assert.equal(slots[1]!.notes, null);
    assert.equal(slots[2]!.customLabel, "Подготовка площадки");
    assert.equal(slots[2]!.notes, "свет");
    assert.equal(slots[3]!.isContinuation, true);
    assert.ok(slots.every((s) => s.unit === "MAIN"));
  });

  test("строки 2-го юнита не пересчитываются и не теряются", () => {
    const second: SecondUnitRow[] = [
      { id: "x", startTime: "9:15", endTime: "", slotType: "SHOOTING", sceneId: S2, isContinuation: false, customLabel: "", notes: "дрон" },
      { id: "y", startTime: "12:00", endTime: "12:45", slotType: "IDLE", sceneId: null, isContinuation: true, customLabel: "Ждём солнце", notes: "" },
    ];
    const slots = buildPlanSlots("08:00", items, second, new Set([CUT]));
    assert.equal(slots.length, 6);
    assert.deepEqual(slots.slice(4), [
      { startTime: "09:15", endTime: null, slotType: "SHOOTING", sceneId: S2, notes: "дрон", unit: "SECOND", isContinuation: false, customLabel: null },
      // «продолжение» без сцены не уходит
      { startTime: "12:00", endTime: "12:45", slotType: "IDLE", sceneId: null, notes: null, unit: "SECOND", isContinuation: false, customLabel: "Ждём солнце" },
    ]);
    // Сдвиг начала смены меняет только основной юнит.
    const later = buildPlanSlots("10:00", items, second, new Set([CUT]));
    assert.equal(later[0]!.startTime, "10:00");
    assert.deepEqual(later.slice(4), slots.slice(4));
  });
});

/** Сцена дня с нужными полями для счётчиков; остальное функциям не нужно. */
function dayScene(id: string, number: string, planSeconds: number, cutAt: Date | null, status = "PLANNING") {
  return {
    id: `as-${id}`,
    estimatedPages: null,
    scene: {
      id,
      number,
      postfix: "",
      episodeNumber: 0,
      planSeconds,
      pageCount: 1,
      status,
      cutAt,
      dayNight: "DAY",
      locations: [{ location: { name: `Объект ${number}` } }],
    },
  };
}

describe("вырезанные сцены дня: счётчики, хронометраж, тайминги", () => {
  const scenes = [
    dayScene(S1, "1", 60, null, "SHOT"),
    dayScene(CUT, "7", 600, new Date("2026-10-30")),
    dayScene(S2, "2", 90, null),
  ];

  test("счётчик сцен, хронометраж и объекты — без вырезанных", () => {
    const stats = buildDayStats({ scenes } as unknown as Parameters<typeof buildDayStats>[0]);
    assert.equal(stats.sceneCount, 2);
    assert.equal(stats.shotCount, 1);
    assert.equal(stats.notShotCount, 1);
    assert.equal(stats.totalSeconds, 150);
    assert.equal(stats.totalPages, 2);
    assert.deepEqual(stats.locations, ["Объект 1", "Объект 2"]);
    assert.deepEqual(activeDayScenes(scenes).map((r) => r.scene.number), ["1", "2"]);
  });

  test("предупреждение на экране правки — по каждой вырезанной сцене", () => {
    const withTwoCut = [...scenes, dayScene("cut2", "8", 0, new Date())];
    assert.deepEqual(cutSceneWarnings(withTwoCut), [
      "В дне КПП стоит вырезанная сцена 7 — уберите её из дня в КПП",
      "В дне КПП стоит вырезанная сцена 8 — уберите её из дня в КПП",
    ]);
    assert.deepEqual(cutSceneWarnings([scenes[0]!]), []);
  });

  const slots = [
    { startTime: "08:00", endTime: "09:00", slotType: "SHOOTING", sceneId: CUT, scene: { cutAt: new Date() } },
    { startTime: "09:00", endTime: "10:00", slotType: "SHOOTING", sceneId: S1, scene: { cutAt: null } },
    { startTime: "10:00", endTime: "11:00", slotType: "SHOOTING", sceneId: S2, scene: { cutAt: null } },
    { startTime: "07:00", endTime: "18:00", slotType: "SHOOTING", sceneId: S2, unit: "SECOND", scene: { cutAt: null } },
  ];

  test("тайминги актёров — без строк вырезанных сцен", () => {
    const baselines = computeActorTimingBaselines({
      timeSlots: slots,
      sceneCharacters: [
        { sceneId: CUT, characterId: "ch1" },
        { sceneId: S1, characterId: "ch1" },
      ],
      actors: [{ id: "actor1", characterId: "ch1", label: "Иванов", pickupOffsetMin: null }],
      characters: [{ id: "ch1", makeupOffsetMin: null, costumeOffsetMin: null }],
    });
    assert.deepEqual(baselines, { actor1: { readyTime: "09:00", wrapTime: "10:00" } });
  });

  test("тайминги ресурсов — без вырезанных сцен; начало/конец дня — по основному юниту", () => {
    const baselines = computeResourceTimingBaselines({
      timeSlots: slots,
      dayScenes: [
        { scene: { id: CUT, cutAt: new Date(), resources: [{ category: "PROP", name: "Пистолет" }], elements: [] } },
        { scene: { id: S1, cutAt: null, resources: [{ category: "PROP", name: "Чашка" }], elements: [] } },
      ],
      shiftStartTime: "08:00",
      callTime: null,
      perShiftUsages: [{ key: "Свет::Генератор", arrivalOffsetMin: 0 }],
    });
    assert.equal(baselines["PROP::Пистолет"], undefined);
    assert.deepEqual(baselines["PROP::Чашка"], { readyTime: "09:00", wrapTime: "10:00", arrivalTime: "08:00" });
    assert.deepEqual(baselines["Свет::Генератор"], { arrivalTime: "08:00", readyTime: "09:00", wrapTime: "11:00" });
  });
});

describe("действие сохранения плана", () => {
  test("saveTimeSlotsAction проверяет через checkTimeSlotsSave до записи и пишет через auditMutation", () => {
    const source = readFileSync(join(process.cwd(), "src/features/day-docs/actions.ts"), "utf8");
    const start = source.indexOf("export async function saveTimeSlotsAction");
    const end = source.indexOf("export async function", start + 1);
    const body = source.slice(start, end);
    assert.ok(start >= 0);
    const check = body.indexOf("checkTimeSlotsSave(");
    const write = body.indexOf("shootDayTimeSlot.");
    assert.ok(check >= 0 && write > check, "проверка — до первой записи");
    assert.ok(body.includes("auditMutation("));
    assert.ok(!body.includes("recordAudit") && !body.includes("auditCallSheet("));
  });
});

describe("шаблоны перерывов", () => {
  test("«Подготовка» есть в базовых и добавляется к сохранённым раньше", () => {
    assert.ok(DEFAULT_BREAK_PRESETS.some((p) => p.slotType === "PREP" && p.label === "Подготовка"));
    const old = DEFAULT_BREAK_PRESETS.filter((p) => p.slotType !== "PREP");
    const merged = withMissingBuiltins([...old, { id: "custom-1", slotType: "IDLE", label: "Кофе", defaultDuration: "00:15", builtin: false }]);
    assert.equal(merged.filter((p) => p.slotType === "PREP").length, 1);
    assert.ok(merged.some((p) => p.id === "custom-1"));
    assert.equal(withMissingBuiltins(DEFAULT_BREAK_PRESETS).length, DEFAULT_BREAK_PRESETS.length);
  });
});
