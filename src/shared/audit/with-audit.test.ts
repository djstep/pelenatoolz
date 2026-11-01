import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditDb } from "@/shared/audit/log";
import { auditMutation } from "@/shared/audit/with-audit";

function fakeDb() {
  const created: unknown[] = [];
  const db = {
    auditLog: {
      create: (args: unknown) => {
        created.push(args);
        return Promise.resolve({});
      },
    },
  } as unknown as AuditDb;
  return { db, created };
}

const meta = {
  projectId: "p1",
  entityType: "project",
  action: "CREATE" as const,
  entityId: "p1",
  summary: "Проект создан",
};

describe("auditMutation с транзакцией", () => {
  it("пишет одну запись в переданную транзакцию", async () => {
    const { db, created } = fakeDb();
    const result = await auditMutation({ user: { id: "u1" } }, async () => "ok", null, meta, { db });
    assert.equal(result, "ok");
    assert.equal(created.length, 1);
    assert.deepEqual((created[0] as { data: { summary: string } }).data.summary, "Проект создан");
  });

  it("действие упало — записи нет, ошибка уходит дальше (транзакция откатится)", async () => {
    const { db, created } = fakeDb();
    await assert.rejects(
      auditMutation(
        { user: { id: "u1" } },
        async () => {
          throw new Error("boom");
        },
        null,
        meta,
        { db },
      ),
      /boom/,
    );
    assert.equal(created.length, 0);
  });
});
