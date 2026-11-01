import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canEditTransportFinance,
  canSeeTransportKmRate,
  checkTransportSave,
  DAY_NOT_FOUND,
  editorRowsPayload,
  NO_RIGHTS,
  parseTransportPayload,
  planTransportSave,
  toEditorRow,
  TRANSPORT_NOT_FOUND,
  type StoredTransport,
  type TransportSaveDeps,
} from "@/features/day-docs/lib/transport-rules";

function stored(over: Partial<StoredTransport> = {}): StoredTransport {
  return {
    id: "t1",
    name: "Кран",
    callTime: "07:00",
    wrapTime: null,
    scenes: null,
    notes: null,
    kmRate: 50,
    budgetItemId: "b1",
    sortOrder: 0,
    ...over,
  };
}

function payload(rows: Record<string, unknown>[]) {
  return JSON.stringify({ rows });
}

/** Фейки зависимостей: «свой» день — day1, строки дня — `existing`. Запоминают вызовы. */
function fakeDeps(
  over: Partial<TransportSaveDeps> & { existing?: StoredTransport[]; usable?: string[] } = {},
) {
  const calls: string[] = [];
  const usable = new Set(over.usable ?? ["b1", "b2"]);
  const deps: TransportSaveDeps = {
    canEdit: over.canEdit ?? true,
    canEditFinance: over.canEditFinance ?? true,
    inProject:
      over.inProject ??
      (async (entity, ids) => {
        calls.push(`inProject:${entity}:${ids.join(",")}`);
        return ids.every((id) => id === "day1");
      }),
    loadDayTransports:
      over.loadDayTransports ??
      (async (dayId) => {
        calls.push(`load:${dayId}`);
        return over.existing ?? [stored()];
      }),
    budgetItemsUsable:
      over.budgetItemsUsable ??
      (async (ids) => {
        calls.push(`items:${ids.join(",")}`);
        return ids.every((id) => usable.has(id)) ? null : "Статья сметы не найдена";
      }),
  };
  return { deps, calls };
}

function rowsOf(raw: string) {
  const parsed = parseTransportPayload(raw);
  assert.ok("data" in parsed, JSON.stringify(parsed));
  return parsed.data.rows;
}

describe("план сохранения спецтранспорта по id", () => {
  test("строка с id обновляется, без id — создаётся, пропавшая — удаляется", () => {
    const existing = [stored({ id: "t1" }), stored({ id: "t2", name: "Генератор", sortOrder: 1 })];
    const result = planTransportSave(
      existing,
      rowsOf(payload([{ id: "t1", name: "Кран 2", callTime: "07:00", kmRate: 50, budgetItemId: "b1" }, { name: "Автодом" }])),
    );
    assert.ok("plan" in result);
    assert.deepEqual(result.plan.update.map((u) => u.id), ["t1"]);
    assert.equal(result.plan.update[0]!.data.name, "Кран 2");
    assert.deepEqual(result.plan.create.map((c) => c.name), ["Автодом"]);
    assert.deepEqual(result.plan.remove, ["t2"]);
  });

  test("никакого пересоздания: без изменений — ничего не пишется, id остаются", () => {
    const existing = [stored({ id: "t1" })];
    const result = planTransportSave(
      existing,
      rowsOf(payload([{ id: "t1", name: "Кран", callTime: "07:00", kmRate: 50, budgetItemId: "b1" }])),
    );
    assert.ok("plan" in result);
    assert.deepEqual(result.plan, {
      create: [],
      update: [],
      remove: [],
      changedBudgetItemIds: [],
      financeChanged: { budgetItem: false, kmRate: false },
    });
  });

  test("порядок — место в списке: sortOrder с нуля подряд, смена порядка — обновление", () => {
    const existing = [
      stored({ id: "t1", sortOrder: 0 }),
      stored({ id: "t2", name: "Генератор", sortOrder: 1 }),
    ];
    const result = planTransportSave(
      existing,
      rowsOf(
        payload([
          { id: "t2", name: "Генератор", callTime: "07:00", kmRate: 50, budgetItemId: "b1" },
          { name: "Новый" },
          { id: "t1", name: "Кран", callTime: "07:00", kmRate: 50, budgetItemId: "b1" },
        ]),
      ),
    );
    assert.ok("plan" in result);
    assert.equal(result.plan.create[0]!.sortOrder, 1);
    const order = Object.fromEntries(result.plan.update.map((u) => [u.id, u.data.sortOrder]));
    assert.deepEqual(order, { t2: 0, t1: 2 });
  });

  test("чужой id (строка другого дня) — отказ «Объект не найден»", () => {
    const result = planTransportSave(
      [stored({ id: "t1" })],
      rowsOf(payload([{ id: "other-day-row", name: "Кран" }])),
    );
    assert.deepEqual(result, { error: TRANSPORT_NOT_FOUND });
  });

  test("ставка и статья не присланы — остаются сохранённые; у новой строки — пусто", () => {
    const result = planTransportSave(
      [stored({ id: "t1", kmRate: 70, budgetItemId: "b2" })],
      rowsOf(payload([{ id: "t1", name: "Кран" }, { name: "Новый" }])),
    );
    assert.ok("plan" in result);
    assert.equal(result.plan.update[0]!.data.kmRate, 70);
    assert.equal(result.plan.update[0]!.data.budgetItemId, "b2");
    assert.equal(result.plan.create[0]!.kmRate, null);
    assert.equal(result.plan.create[0]!.budgetItemId, null);
    assert.deepEqual(result.plan.financeChanged, { budgetItem: false, kmRate: false });
  });

  test("поля строки: конец, сцены, время ЧЧ:ММ, ставка ≥ 0, повтор id", () => {
    const rows = rowsOf(
      payload([{ name: " Кран ", callTime: "06:30", wrapTime: "20:00", scenes: "1, 2, 5А", notes: "" }]),
    );
    assert.deepEqual(rows[0], {
      id: null,
      name: "Кран",
      callTime: "06:30",
      wrapTime: "20:00",
      scenes: "1, 2, 5А",
      notes: null,
    });
    // Ставка и статья не присланы — «оставить как сохранено».
    assert.equal(rows[0]!.kmRate, undefined);
    assert.equal(rows[0]!.budgetItemId, undefined);
    assert.ok("error" in parseTransportPayload(payload([{ name: "" }])));
    assert.ok("error" in parseTransportPayload(payload([{ name: "Кран", wrapTime: "25:00" }])));
    assert.ok("error" in parseTransportPayload(payload([{ name: "Кран", scenes: "x".repeat(201) }])));
    assert.ok("error" in parseTransportPayload(payload([{ name: "Кран", kmRate: -1 }])));
    assert.ok("error" in parseTransportPayload(payload([{ name: "Кран", kmRate: "abc" }])));
    assert.ok(
      "error" in parseTransportPayload(payload([{ id: "t1", name: "А" }, { id: "t1", name: "Б" }])),
    );
    assert.ok("error" in parseTransportPayload("{не json"));
  });
});

describe("проверки сохранения (действие вызывает checkTransportSave)", () => {
  test("без права правки вызывного — отказ до базы", async () => {
    const { deps, calls } = fakeDeps({ canEdit: false });
    const result = await checkTransportSave(deps, "day1", payload([]));
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.deepEqual(calls, []);
  });

  test("чужой день — отказ, строки не читаются", async () => {
    const { deps, calls } = fakeDeps();
    const result = await checkTransportSave(deps, "foreign-day", payload([]));
    assert.deepEqual(result, { error: DAY_NOT_FOUND });
    assert.deepEqual(calls, ["inProject:ShootDay:foreign-day"]);
    assert.deepEqual(await checkTransportSave(deps, "", payload([])), { error: DAY_NOT_FOUND });
  });

  test("строки читаются только у проверенного дня; чужой id строки — отказ", async () => {
    const { deps, calls } = fakeDeps();
    const result = await checkTransportSave(deps, "day1", payload([{ id: "t-other", name: "Кран" }]));
    assert.deepEqual(result, { error: TRANSPORT_NOT_FOUND });
    assert.deepEqual(calls, ["inProject:ShootDay:day1", "load:day1"]);
  });

  test("правило волны 2в: без фин. права присланная статья отбрасывается, остальное сохраняется", async () => {
    const { deps, calls } = fakeDeps({ canEditFinance: false });
    const result = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран переименован", budgetItemId: "b2" }]),
    );
    assert.ok("plan" in result, JSON.stringify(result));
    assert.equal(result.plan.update[0]!.data.name, "Кран переименован");
    assert.equal(result.plan.update[0]!.data.budgetItemId, "b1", "прежняя статья");
    assert.deepEqual(result.plan.changedBudgetItemIds, []);
    assert.deepEqual(result.plan.financeChanged, { budgetItem: false, kmRate: false });
    assert.ok(calls.includes("items:"), "чужая статья не проверяется — её нет в плане");
  });

  test("без фин. права: новая строка — без статьи и ставки; убрать статью нельзя — остаётся прежняя", async () => {
    const { deps } = fakeDeps({ canEditFinance: false });
    const added = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран" }, { name: "Новый", budgetItemId: "b1", kmRate: 10 }]),
    );
    assert.ok("plan" in added, JSON.stringify(added));
    assert.equal(added.plan.create[0]!.name, "Новый");
    assert.equal(added.plan.create[0]!.budgetItemId, null);
    assert.equal(added.plan.create[0]!.kmRate, null);

    const cleared = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран", callTime: "07:00", budgetItemId: "", kmRate: null }]),
    );
    assert.ok("plan" in cleared, JSON.stringify(cleared));
    assert.deepEqual(cleared.plan.update, [], "статья и ставка прежние — менять нечего");
  });

  test("без фин. права присланная ставка км отбрасывается, прежняя остаётся", async () => {
    const { deps } = fakeDeps({ canEditFinance: false });
    const result = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран", callTime: "09:00", kmRate: 60 }]),
    );
    assert.ok("plan" in result, JSON.stringify(result));
    assert.equal(result.plan.update[0]!.data.callTime, "09:00");
    assert.equal(result.plan.update[0]!.data.kmRate, 50);
  });

  test("без фин. права оставить статью и ставку как были — можно (присланы те же или не присланы)", async () => {
    const { deps } = fakeDeps({ canEditFinance: false });
    const same = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран", callTime: "08:00", kmRate: 50, budgetItemId: "b1" }]),
    );
    assert.ok("plan" in same, JSON.stringify(same));
    assert.equal(same.plan.update[0]!.data.callTime, "08:00");
    assert.equal(same.plan.update[0]!.data.budgetItemId, "b1");

    const omitted = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран" }, { name: "Новый без статьи" }]),
    );
    assert.ok("plan" in omitted, JSON.stringify(omitted));
    assert.equal(omitted.plan.update[0]!.data.budgetItemId, "b1");
    assert.equal(omitted.plan.update[0]!.data.kmRate, 50);
  });

  test("с фин. правом статья и ставка меняются; смета проверяет только новые на своей строке", async () => {
    const { deps, calls } = fakeDeps({
      existing: [stored({ id: "t1", budgetItemId: "b1" }), stored({ id: "t2", budgetItemId: "b-archived" })],
    });
    const result = await checkTransportSave(
      deps,
      "day1",
      payload([
        { id: "t1", name: "Кран", kmRate: 80, budgetItemId: "b2" },
        // У t2 стоит статья, которую сейчас поставить нельзя (архив) — оставить можно.
        { id: "t2", name: "Кран", callTime: "07:00", kmRate: 50, budgetItemId: "b-archived" },
      ]),
    );
    assert.ok("plan" in result, JSON.stringify(result));
    assert.equal(result.plan.update[0]!.data.budgetItemId, "b2");
    assert.equal(result.plan.update[0]!.data.kmRate, 80);
    assert.ok(calls.includes("items:b2"));
  });

  test("чужая статья — отказ", async () => {
    const { deps } = fakeDeps();
    const result = await checkTransportSave(
      deps,
      "day1",
      payload([{ id: "t1", name: "Кран", budgetItemId: "foreign" }]),
    );
    assert.deepEqual(result, { error: "Статья сметы не найдена" });
  });
});

describe("права и строки редактора", () => {
  const access = (perms: string[]) => ({ can: (p: string) => perms.includes(p) });

  test("фин. право спецтранспорта — «Финансы: правка»; ставку видно с просмотром финансов", () => {
    assert.equal(canEditTransportFinance(access(["finance:write"])), true);
    assert.equal(canEditTransportFinance(access(["finance:read", "schedule:write"])), false);
    assert.equal(canSeeTransportKmRate(access(["finance:read"])), true);
    assert.equal(canSeeTransportKmRate(access(["schedule:write"])), false);
  });

  test("без права ставка не уходит в браузер и не присылается обратно", () => {
    const row = toEditorRow(stored({ kmRate: 50 }), false);
    assert.equal(row.kmRate, "");
    const sent = JSON.parse(editorRowsPayload([row], false));
    assert.deepEqual(Object.keys(sent.rows[0]).sort(), [
      "callTime",
      "id",
      "name",
      "notes",
      "scenes",
      "wrapTime",
    ]);
    const withFinance = JSON.parse(editorRowsPayload([toEditorRow(stored(), true)], true));
    assert.equal(withFinance.rows[0].kmRate, 50);
    assert.equal(withFinance.rows[0].budgetItemId, "b1");
  });

  test("новая строка уходит без id", () => {
    const sent = JSON.parse(editorRowsPayload([{ ...toEditorRow(stored(), true), id: "" }], true));
    assert.equal("id" in sent.rows[0], false);
  });
});
