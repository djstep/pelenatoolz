import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { serializeForClient } from "./serialize-decimal";

describe("serializeForClient", () => {
  it("Decimal на любой глубине становится числом", () => {
    const row = {
      pageCount: new Prisma.Decimal("1.5"),
      zero: new Prisma.Decimal(0),
      scenes: [{ shootDayScenes: [{ estimatedPages: new Prisma.Decimal("0.25") }] }],
    };
    assert.deepEqual(serializeForClient(row), {
      pageCount: 1.5,
      zero: 0,
      scenes: [{ shootDayScenes: [{ estimatedPages: 0.25 }] }],
    });
  });

  it("остальное не меняется: пусто, дата, строка", () => {
    const date = new Date("2026-11-10T00:00:00.000Z");
    const result = serializeForClient({ empty: null, missing: undefined, date, text: "1.5" });
    assert.equal(result.empty, null);
    assert.equal(result.missing, undefined);
    assert.equal(result.date, date);
    assert.equal(result.text, "1.5");
  });
});
