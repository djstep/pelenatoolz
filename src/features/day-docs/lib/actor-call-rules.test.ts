import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
  ACTOR_NOT_FOUND,
  BAD_FORMAT,
  checkActorCallsSave,
  DAY_NOT_FOUND,
  NO_RIGHTS,
  type ActorCallsDeps,
} from "@/features/day-docs/lib/actor-call-rules";

const ACTOR_A = "cactora0000001";
const ACTOR_B = "cactorb0000002";
const FOREIGN = "cactorx0000099";

function fakeDeps(over: Partial<{ canEdit: boolean }> = {}) {
  const calls: string[] = [];
  const deps: ActorCallsDeps = {
    canEdit: over.canEdit ?? true,
    dayInProject: async (dayId) => {
      calls.push(`day:${dayId}`);
      return dayId === "day1";
    },
    actorsInProject: async (ids) => {
      calls.push(`actors:${ids.join(",")}`);
      return !ids.includes(FOREIGN);
    },
  };
  return { deps, calls };
}

function rows(list: Record<string, unknown>[]) {
  return JSON.stringify(list);
}

describe("тайминги актёров: проверки сохранения (действие вызывает checkActorCallsSave)", () => {
  test("без права правки вызывного — отказ до базы", async () => {
    const { deps, calls } = fakeDeps({ canEdit: false });
    const result = await checkActorCallsSave(
      deps,
      "day1",
      rows([{ actorId: ACTOR_A, transportMode: "CAR", carPickupTime: "07:15" }]),
    );
    assert.deepEqual(result, { error: NO_RIGHTS });
    assert.deepEqual(calls, []);
  });

  test("чужой день — отказ, актёры не проверяются; чужой актёр — отказ", async () => {
    const day = fakeDeps();
    assert.deepEqual(await checkActorCallsSave(day.deps, "foreign", rows([])), { error: DAY_NOT_FOUND });
    assert.deepEqual(day.calls, ["day:foreign"]);
    assert.deepEqual(await checkActorCallsSave(day.deps, "", rows([])), { error: DAY_NOT_FOUND });

    const actor = fakeDeps();
    const result = await checkActorCallsSave(
      actor.deps,
      "day1",
      rows([{ actorId: FOREIGN, arrivalTime: "08:00" }]),
    );
    assert.deepEqual(result, { error: ACTOR_NOT_FOUND });
    assert.deepEqual(await checkActorCallsSave(actor.deps, "day1", "{не json"), { error: BAD_FORMAT });
  });

  test("подача машины хранится только при «машина»; при «сам», своём тексте и без режима — стирается", async () => {
    const { deps } = fakeDeps();
    const result = await checkActorCallsSave(
      deps,
      "day1",
      rows([
        { actorId: ACTOR_A, transportMode: "CAR", carPickupTime: "07:15", transportText: "лишнее" },
        { actorId: ACTOR_B, transportMode: "SELF", carPickupTime: "06:00", arrivalTime: "08:00" },
        { actorId: "cactorc0000003", transportMode: "CUSTOM", transportText: "такси", carPickupTime: "06:30" },
        { actorId: "cactord0000004", transportMode: "", carPickupTime: "06:45", arrivalTime: "09:00" },
      ]),
    );
    assert.ok("rows" in result, JSON.stringify(result));
    const [car, self, custom, none] = result.rows;
    assert.equal(car!.carPickupTime, "07:15");
    assert.equal(car!.transportText, null, "свой текст — только у «свой текст»");
    assert.equal(self!.carPickupTime, null);
    assert.equal(custom!.carPickupTime, null);
    assert.equal(custom!.transportText, "такси");
    assert.equal(none!.carPickupTime, null);
    assert.equal(none!.transportMode, null);
  });

  test("пустые строки не пишутся; «машина» без времён — пишется", async () => {
    const { deps } = fakeDeps();
    const result = await checkActorCallsSave(
      deps,
      "day1",
      rows([
        { actorId: ACTOR_A, transportMode: "", carPickupTime: "07:15" },
        { actorId: ACTOR_B, transportMode: "CAR" },
      ]),
    );
    assert.ok("rows" in result);
    assert.deepEqual(result.rows.map((r) => r.actorId), [ACTOR_B]);
  });

  test("«свой текст» без текста — отказ", async () => {
    const { deps } = fakeDeps();
    const result = await checkActorCallsSave(
      deps,
      "day1",
      rows([{ actorId: ACTOR_A, transportMode: "CUSTOM", transportText: "" }]),
    );
    assert.ok("error" in result);
  });

  test("действие сохраняет только то, что вернула проверка, право — как у всех таймингов", () => {
    const source = readFileSync(path.join(process.cwd(), "src/features/day-docs/actions.ts"), "utf8");
    const start = source.indexOf("export async function saveActorCallsAction(");
    const body = source.slice(start, source.indexOf("export async function", start + 10));
    const check = body.indexOf("checkActorCallsSave(");
    assert.ok(check > 0);
    assert.ok(check < body.indexOf("prisma."), "проверка — до первой записи");
    assert.ok(body.includes(`ctx.can("callsheet:write") || ctx.can("schedule:write")`));
    assert.ok(body.includes("auditMutation("));
  });
});
