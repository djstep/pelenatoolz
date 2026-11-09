import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { auditDateBounds, formatAuditTime } from "@/features/audit/lib/audit-time";

describe("время журнала", () => {
  test("показывается по поясу проекта, а не сервера", () => {
    const at = new Date("2026-11-09T21:30:05Z");
    assert.equal(formatAuditTime(at, "Europe/Moscow"), "10.11.2026, 00:30:05");
    assert.equal(formatAuditTime(at, "Asia/Novosibirsk"), "10.11.2026, 04:30:05");
    assert.equal(formatAuditTime(at, "UTC"), "09.11.2026, 21:30:05");
  });

  test("фильтр по дням — границы суток по поясу проекта, «по» включает весь день", () => {
    const { gte, lt } = auditDateBounds("2026-11-10", "2026-11-10", "Europe/Moscow");
    assert.equal(gte?.toISOString(), "2026-11-09T21:00:00.000Z");
    assert.equal(lt?.toISOString(), "2026-11-10T21:00:00.000Z");
  });

  test("неверная дата не ломает запрос, край просто не ставится", () => {
    assert.deepEqual(auditDateBounds("завтра", "2026-02-30", "Europe/Moscow"), {});
    assert.deepEqual(auditDateBounds(undefined, undefined, "UTC"), {});
  });
});
