import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lockProjectOwner, OWNER_PROTECTED_ERROR } from "./owner";

function fakeTx(rows: { ownerUserId: string }[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ sql: strings.join("?"), values });
    return Promise.resolve(rows);
  };
  return { tx: { $queryRaw } as unknown as Parameters<typeof lockProjectOwner>[0], calls };
}

describe("lockProjectOwner", () => {
  it("блокирует строку проекта и возвращает владельца", async () => {
    const { tx, calls } = fakeTx([{ ownerUserId: "u1" }]);
    assert.equal(await lockProjectOwner(tx, "p1"), "u1");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.sql, /FROM "Project" WHERE "id" = \? FOR UPDATE/);
    assert.deepEqual(calls[0]!.values, ["p1"]);
  });

  it("нет проекта — null", async () => {
    const { tx } = fakeTx([]);
    assert.equal(await lockProjectOwner(tx, "p1"), null);
  });

  it("текст отказа — как в ТЗ", () => {
    assert.equal(OWNER_PROTECTED_ERROR, "Это владелец проекта — сначала передайте владение");
  });
});
