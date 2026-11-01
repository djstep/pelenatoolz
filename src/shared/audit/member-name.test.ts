import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { auditMemberName } from "./member-name";

describe("auditMemberName", () => {
  test("имя без лишних пробелов", () => {
    assert.equal(auditMemberName("  test test "), "test test");
  });

  test("нет имени — «Без имени», почта не подставляется", () => {
    assert.equal(auditMemberName(""), "Без имени");
    assert.equal(auditMemberName("   "), "Без имени");
    assert.equal(auditMemberName(null), "Без имени");
    assert.equal(auditMemberName(undefined), "Без имени");
  });
});
