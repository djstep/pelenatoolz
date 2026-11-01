import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCallSheetCopies,
  canEditCallSheets,
  checkCallSheetCommand,
  checkTemplateSave,
  DAY_NOT_FOUND,
  DEPARTMENT_NOT_FOUND,
  MEMBER_NOT_FOUND,
  NO_RIGHTS,
  parseTemplatePayload,
  templateAuditView,
  type InProjectCheck,
  type TemplateForCopy,
} from "@/features/call-sheets/lib/template-rules";

function leader(over: Record<string, unknown> = {}) {
  return { position: "Режиссёр", shortTitle: "", membershipId: "", personName: "", phone: "", ...over };
}

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({ leaders: [], crewCalls: [], baseItems: [], ...over });
}

/** Проверка проекта: «свои» id перечислены, остальное — чужое. Запоминает вызовы. */
function fakeInProject(own: string[]) {
  const calls: { entity: string; ids: string[] }[] = [];
  const check: InProjectCheck = async (entity, ids) => {
    calls.push({ entity, ids });
    return ids.every((id) => own.includes(id));
  };
  return { check, calls };
}

describe("права на шаблон и вызывной", () => {
  test("правка — только с «КПП и вызывные: правка»", () => {
    const access = (granted: string[]) => ({ can: (p: string) => granted.includes(p) });
    assert.equal(canEditCallSheets(access(["schedule:read", "callsheet:read"])), false);
    assert.equal(canEditCallSheets(access(["schedule:write"])), true);
    assert.equal(canEditCallSheets(access(["callsheet:write"])), true);
  });

  test("без права сохранение шаблона — отказ, база не трогается", async () => {
    const { check, calls } = fakeInProject(["m1"]);
    const result = await checkTemplateSave(
      { canEdit: false, inProject: check },
      payload({ leaders: [leader({ membershipId: "m1" })] }),
    );
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.equal(calls.length, 0);
  });

  test("без права «Создать вызывной» и «Обновить из шаблона» — отказ", async () => {
    const { check, calls } = fakeInProject(["d1"]);
    assert.deepEqual(await checkCallSheetCommand({ canEdit: false, inProject: check }, "d1"), {
      error: NO_RIGHTS,
    });
    assert.equal(calls.length, 0);
  });
});

describe("чужой проект", () => {
  test("участник другого проекта — отказ", async () => {
    const { check, calls } = fakeInProject(["m1"]);
    const result = await checkTemplateSave(
      { canEdit: true, inProject: check },
      payload({ leaders: [leader({ membershipId: "m1" }), leader({ membershipId: "foreign" })] }),
    );
    assert.deepEqual(result, { error: MEMBER_NOT_FOUND });
    assert.deepEqual(calls[0], { entity: "ProjectMembership", ids: ["m1", "foreign"] });
  });

  test("цех другого проекта — отказ", async () => {
    const { check } = fakeInProject([]);
    const result = await checkTemplateSave(
      { canEdit: true, inProject: check },
      payload({ crewCalls: [{ departmentId: "foreign", label: "", callTime: "" }] }),
    );
    assert.deepEqual(result, { error: DEPARTMENT_NOT_FOUND });
  });

  test("день другого проекта — отказ", async () => {
    const { check, calls } = fakeInProject(["d1"]);
    assert.deepEqual(await checkCallSheetCommand({ canEdit: true, inProject: check }, "foreign"), {
      error: DAY_NOT_FOUND,
    });
    assert.deepEqual(calls, [{ entity: "ShootDay", ids: ["foreign"] }]);
    assert.deepEqual(await checkCallSheetCommand({ canEdit: true, inProject: check }, "d1"), {
      dayId: "d1",
    });
  });

  test("свои участники и цеха — проходят", async () => {
    const { check } = fakeInProject(["m1", "dep1"]);
    const result = await checkTemplateSave(
      { canEdit: true, inProject: check },
      payload({
        leaders: [leader({ membershipId: "m1" })],
        crewCalls: [{ departmentId: "dep1", label: "", callTime: "08:00" }],
      }),
    );
    assert.ok("data" in result);
  });
});

describe("проверка строк шаблона", () => {
  test("цех без выбора и без названия — ошибка", () => {
    const result = parseTemplatePayload(
      payload({ crewCalls: [{ departmentId: "", label: " ", callTime: "" }] }),
    );
    assert.ok("error" in result);
  });

  test("один цех дважды — ошибка", () => {
    const row = { departmentId: "dep1", label: "", callTime: "" };
    const result = parseTemplatePayload(payload({ crewCalls: [row, row] }));
    assert.deepEqual(result, { error: "Один цех добавлен в вызов дважды" });
  });

  test("время только ЧЧ:ММ, телефон свободного имени проверяется", () => {
    assert.ok(
      "error" in
        parseTemplatePayload(payload({ baseItems: [{ name: "Автобус", callTime: "25:00", notNeeded: false }] })),
    );
    assert.ok("error" in parseTemplatePayload(payload({ leaders: [leader({ phone: "звонить" })] })));
    assert.ok("error" in parseTemplatePayload(payload({ leaders: [leader({ position: " " })] })));
  });

  test("участник проекта: своё имя и телефон строки не хранятся", () => {
    const result = parseTemplatePayload(
      payload({ leaders: [leader({ membershipId: "m1", personName: "Иван", phone: "+7 999 000-00-00" })] }),
    );
    assert.ok("data" in result);
    assert.deepEqual(result.data.leaders[0], {
      position: "Режиссёр",
      shortTitle: null,
      membershipId: "m1",
      personName: null,
      phone: null,
    });
  });

  test("порядок строк — порядок в списке после перетаскивания", () => {
    const names = ["Автобус", "Вагончик", "Кейтеринг"];
    const moved = [names[2], names[0], names[1]];
    const result = parseTemplatePayload(
      payload({ baseItems: moved.map((name) => ({ name, callTime: "", notNeeded: false })) }),
    );
    assert.ok("data" in result);
    assert.deepEqual(
      result.data.baseItems.map((row) => row.name),
      ["Кейтеринг", "Автобус", "Вагончик"],
    );
  });

  test("мусор вместо JSON — ошибка", () => {
    assert.ok("error" in parseTemplatePayload("{oops"));
    assert.ok("error" in parseTemplatePayload(JSON.stringify({ leaders: "x" })));
  });
});

const template: TemplateForCopy = {
  leaders: [
    {
      position: "Режиссёр-постановщик",
      shortTitle: "Режиссёр",
      membershipId: "m1",
      personName: null,
      phone: null,
      member: { name: "Анна Петрова", phone: "+7 900 111-22-33" },
    },
    {
      position: "Водитель",
      shortTitle: null,
      membershipId: null,
      personName: "Сергей",
      phone: "8 900 000 00 00",
      member: null,
    },
    {
      position: "Второй режиссёр",
      shortTitle: null,
      membershipId: "gone",
      personName: null,
      phone: null,
      member: null,
    },
  ],
  crewCalls: [
    { departmentId: "dep1", label: null, departmentName: "Операторский", callTime: "07:00" },
    { departmentId: null, label: "Каскадёры", departmentName: null, callTime: null },
  ],
  baseItems: [
    { name: "Кейтеринг", callTime: "12:00", notNeeded: false },
    { name: "Вагончик", callTime: null, notNeeded: true },
  ],
};

describe("создание вызывного из шаблона", () => {
  test("ФИ и телефон участника копируются, свободное имя — со своим телефоном", () => {
    const copies = buildCallSheetCopies(template);
    assert.deepEqual(copies.leaders, [
      {
        position: "Режиссёр-постановщик",
        shortTitle: "Режиссёр",
        membershipId: "m1",
        personName: "Анна Петрова",
        phone: "+7 900 111-22-33",
        sortOrder: 0,
      },
      {
        position: "Водитель",
        shortTitle: null,
        membershipId: null,
        personName: "Сергей",
        phone: "8 900 000 00 00",
        sortOrder: 1,
      },
      // Участник не активен — должность остаётся, человека нет.
      {
        position: "Второй режиссёр",
        shortTitle: null,
        membershipId: null,
        personName: null,
        phone: null,
        sortOrder: 2,
      },
    ]);
  });

  test("название цеха копируется, своя строка — как есть, порядок — с нуля подряд", () => {
    const copies = buildCallSheetCopies(template);
    assert.deepEqual(copies.crewCalls, [
      { departmentId: "dep1", label: "Операторский", callTime: "07:00", sortOrder: 0 },
      { departmentId: null, label: "Каскадёры", callTime: null, sortOrder: 1 },
    ]);
    assert.deepEqual(copies.baseItems, [
      { name: "Кейтеринг", callTime: "12:00", notNeeded: false, sortOrder: 0 },
      { name: "Вагончик", callTime: null, notNeeded: true, sortOrder: 1 },
    ]);
  });

  test("пустой шаблон — пустые блоки", () => {
    assert.deepEqual(buildCallSheetCopies({ leaders: [], crewCalls: [], baseItems: [] }), {
      leaders: [],
      crewCalls: [],
      baseItems: [],
    });
  });
});

describe("«Обновить из шаблона»", () => {
  test("берёт текущие профиль и шаблон, а не прошлую копию", () => {
    const first = buildCallSheetCopies(template);
    const changed: TemplateForCopy = {
      ...template,
      leaders: [
        { ...template.leaders[0]!, member: { name: "Анна Петрова", phone: "+7 900 999-99-99" } },
      ],
      crewCalls: [
        { ...template.crewCalls[0]!, departmentName: "Операторский цех" },
        ...template.crewCalls.slice(1),
      ],
      baseItems: [template.baseItems[1]!, template.baseItems[0]!],
    };
    const refreshed = buildCallSheetCopies(changed);
    assert.equal(first.leaders[0]!.phone, "+7 900 111-22-33");
    assert.equal(refreshed.leaders.length, 1);
    assert.equal(refreshed.leaders[0]!.phone, "+7 900 999-99-99");
    assert.equal(refreshed.crewCalls[0]!.label, "Операторский цех");
    assert.deepEqual(
      refreshed.baseItems.map((row) => [row.name, row.sortOrder]),
      [
        ["Вагончик", 0],
        ["Кейтеринг", 1],
      ],
    );
  });
});

describe("журнал шаблона", () => {
  test("без телефонов", () => {
    const parsed = parseTemplatePayload(
      payload({
        leaders: [leader({ personName: "Сергей", phone: "+7 900 123-45-67" }), leader({ membershipId: "m1" })],
      }),
    );
    assert.ok("data" in parsed);
    const view = templateAuditView(parsed.data, {
      members: new Map([["m1", "Анна Петрова"]]),
      departments: new Map(),
    });
    const text = JSON.stringify(view);
    assert.ok(!text.includes("123-45-67"));
    assert.ok(!text.includes("phone"));
    assert.deepEqual(
      view.leaders.map((row) => row.person),
      ["Сергей", "Анна Петрова"],
    );
  });
});
