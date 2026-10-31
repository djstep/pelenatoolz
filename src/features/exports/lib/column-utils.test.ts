import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  exportLayoutPermission,
  isExportLayoutKey,
} from "@/features/exports/lib/column-utils";
import { EXPORT_LAYOUT_KEYS } from "@/features/exports/types";

describe("exportLayoutPermission", () => {
  test("КПП — раздел «КПП и вызывные»", () => {
    for (const key of ["kppFull", "kppShort"] as const) {
      assert.equal(exportLayoutPermission(key, "read"), "schedule:read");
      assert.equal(exportLayoutPermission(key, "write"), "schedule:write");
    }
  });

  test("либретто и режиссёрский сценарий — раздел «Сцены»", () => {
    for (const key of ["libretto", "directorsScript"] as const) {
      assert.equal(exportLayoutPermission(key, "read"), "script:read");
      assert.equal(exportLayoutPermission(key, "write"), "script:write");
    }
  });

  test("у каждого ключа есть право, «Настройки проекта» не используются", () => {
    for (const key of EXPORT_LAYOUT_KEYS) {
      assert.ok(exportLayoutPermission(key, "read").endsWith(":read"));
      assert.ok(exportLayoutPermission(key, "write").endsWith(":write"));
      assert.ok(!exportLayoutPermission(key, "write").startsWith("project:"));
    }
  });

  test("неизвестный ключ не проходит проверку ключа", () => {
    assert.equal(isExportLayoutKey("attendanceSheet"), false);
    assert.equal(isExportLayoutKey("unknown"), false);
  });
});
