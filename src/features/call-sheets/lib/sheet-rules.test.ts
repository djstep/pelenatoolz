import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildSheetRows,
  changedMemberIds,
  checkSheetSave,
  MEMBER_LEFT,
  parseSheetPayload,
  SCHEME_LOCATION_NOT_FOUND,
  SHEET_DEPARTMENT_NOT_FOUND,
  sheetAuditView,
  type StoredLeader,
} from "@/features/call-sheets/lib/sheet-rules";
import { NO_RIGHTS, type InProjectCheck } from "@/features/call-sheets/lib/template-rules";

function leader(over: Record<string, unknown> = {}) {
  return {
    id: "",
    position: "Режиссёр",
    shortTitle: "",
    membershipId: "",
    personName: "",
    phone: "",
    ...over,
  };
}

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    tempDay: "",
    tempNight: "",
    importantNote: "",
    actorRestrictions: "",
    schemeLocationId: "",
    leaders: [],
    crewCalls: [],
    baseItems: [],
    ...over,
  });
}

function fakeInProject(own: string[]) {
  const calls: { entity: string; ids: string[] }[] = [];
  const check: InProjectCheck = async (entity, ids) => {
    calls.push({ entity, ids });
    return ids.every((id) => own.includes(id));
  };
  return { check, calls };
}

const stored: StoredLeader[] = [
  { id: "r1", membershipId: "m1", personName: "Анна Петрова", phone: "+7 900 111-22-33" },
  { id: "r2", membershipId: null, personName: "Сергей", phone: "8 900 000 00 00" },
];

describe("права и чужой проект", () => {
  test("без права правки — отказ, база не трогается", async () => {
    const { check, calls } = fakeInProject(["m1"]);
    const result = await checkSheetSave({ canEdit: false, inProject: check }, payload(), stored);
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.equal(calls.length, 0);
  });

  test("новый участник другого проекта — отказ", async () => {
    const { check } = fakeInProject(["m1"]);
    const result = await checkSheetSave(
      { canEdit: true, inProject: check },
      payload({ leaders: [leader({ membershipId: "foreign" })] }),
      stored,
    );
    assert.deepEqual(result, { error: MEMBER_LEFT });
  });

  test("цех и объект схемы другого проекта — отказ", async () => {
    const { check } = fakeInProject([]);
    assert.deepEqual(
      await checkSheetSave(
        { canEdit: true, inProject: check },
        payload({ crewCalls: [{ departmentId: "foreign", label: "", callTime: "" }] }),
        stored,
      ),
      { error: SHEET_DEPARTMENT_NOT_FOUND },
    );
    const { check: check2, calls } = fakeInProject([]);
    assert.deepEqual(
      await checkSheetSave(
        { canEdit: true, inProject: check2 },
        payload({ schemeLocationId: "foreignLoc" }),
        stored,
      ),
      { error: SCHEME_LOCATION_NOT_FOUND },
    );
    assert.deepEqual(calls.at(-1), { entity: "Location", ids: ["foreignLoc"] });
  });

  test("тот же участник в той же строке не проверяется заново (мог выйти из проекта)", async () => {
    const { check, calls } = fakeInProject([]);
    const result = await checkSheetSave(
      { canEdit: true, inProject: check },
      payload({ leaders: [leader({ id: "r1", membershipId: "m1" })] }),
      stored,
    );
    assert.ok("data" in result);
    assert.deepEqual(calls[0], { entity: "ProjectMembership", ids: [] });
  });
});

describe("строки вызывного", () => {
  test("участник тот же — прежний снимок, новый — из профиля, свободное имя — как ввели", () => {
    const parsed = parseSheetPayload(
      payload({
        leaders: [
          leader({ id: "r1", membershipId: "m1", personName: "Подмена", phone: "+7 999 999-99-99" }),
          leader({ id: "r2", position: "Водитель", personName: "Пётр", phone: "8 911 000 00 00" }),
          leader({ position: "Второй режиссёр", membershipId: "m2" }),
        ],
      }),
    );
    assert.ok("data" in parsed);
    const rows = buildSheetRows(
      parsed.data,
      stored,
      new Map([
        ["m1", { name: "Анна Петрова-Новая", phone: "+7 900 000-00-01" }],
        ["m2", { name: "Олег", phone: null }],
      ]),
      new Map(),
    );
    assert.deepEqual(rows.leaders, [
      {
        position: "Режиссёр",
        shortTitle: null,
        membershipId: "m1",
        personName: "Анна Петрова",
        phone: "+7 900 111-22-33",
        sortOrder: 0,
      },
      {
        position: "Водитель",
        shortTitle: null,
        membershipId: null,
        personName: "Пётр",
        phone: "8 911 000 00 00",
        sortOrder: 1,
      },
      {
        position: "Второй режиссёр",
        shortTitle: null,
        membershipId: "m2",
        personName: "Олег",
        phone: null,
        sortOrder: 2,
      },
    ]);
  });

  test("в строке сменили человека — снимок из профиля нового", () => {
    const parsed = parseSheetPayload(payload({ leaders: [leader({ id: "r2", membershipId: "m1" })] }));
    assert.ok("data" in parsed);
    assert.deepEqual(changedMemberIds(parsed.data.leaders, stored), ["m1"]);
    const rows = buildSheetRows(
      parsed.data,
      stored,
      new Map([["m1", { name: "Анна", phone: "+7 900 1" }]]),
      new Map(),
    );
    assert.equal(rows.leaders[0]!.personName, "Анна");
  });

  test("цех без своего названия — название цеха; порядок — как в форме", () => {
    const parsed = parseSheetPayload(
      payload({
        crewCalls: [
          { departmentId: "", label: "Каскадёры", callTime: "06:30" },
          { departmentId: "dep1", label: "", callTime: "07:00" },
        ],
        baseItems: [
          { name: "Вагончик", callTime: "", notNeeded: true },
          { name: "Кейтеринг", callTime: "12:00", notNeeded: false },
        ],
      }),
    );
    assert.ok("data" in parsed);
    const rows = buildSheetRows(parsed.data, [], new Map(), new Map([["dep1", "Операторский"]]));
    assert.deepEqual(rows.crewCalls, [
      { departmentId: null, label: "Каскадёры", callTime: "06:30", sortOrder: 0 },
      { departmentId: "dep1", label: "Операторский", callTime: "07:00", sortOrder: 1 },
    ]);
    assert.deepEqual(
      rows.baseItems.map((row) => [row.name, row.sortOrder, row.notNeeded]),
      [
        ["Вагончик", 0, true],
        ["Кейтеринг", 1, false],
      ],
    );
  });

  test("поля листа: пусто — null, длины и время проверяются", () => {
    const ok = parseSheetPayload(
      payload({ tempDay: " +18 ", importantNote: "Пропуск на объект по паспорту" }),
    );
    assert.ok("data" in ok);
    assert.equal(ok.data.tempDay, "+18");
    assert.equal(ok.data.tempNight, null);
    assert.ok("error" in parseSheetPayload(payload({ tempDay: "x".repeat(21) })));
    assert.ok(
      "error" in
        parseSheetPayload(payload({ baseItems: [{ name: "Автобус", callTime: "7:00", notNeeded: false }] })),
    );
    assert.ok("error" in parseSheetPayload(payload({ leaders: [leader({ position: " " })] })));
    assert.ok("error" in parseSheetPayload("{oops"));
  });

  test("один цех дважды — ошибка", () => {
    const row = { departmentId: "dep1", label: "", callTime: "" };
    assert.deepEqual(parseSheetPayload(payload({ crewCalls: [row, row] })), {
      error: "Один цех добавлен в вызов дважды",
    });
  });

  test("журнал — без телефонов", () => {
    const parsed = parseSheetPayload(
      payload({ leaders: [leader({ personName: "Сергей", phone: "+7 900 123-45-67" })] }),
    );
    assert.ok("data" in parsed);
    const view = sheetAuditView(parsed.data, buildSheetRows(parsed.data, [], new Map(), new Map()));
    const text = JSON.stringify(view);
    assert.ok(!text.includes("123-45-67"));
    assert.ok(!text.includes("phone"));
  });
});
