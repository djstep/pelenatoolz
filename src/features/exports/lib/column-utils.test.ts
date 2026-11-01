import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ATTENDANCE_SHEET_WRITE_PERMISSION,
  exportLayoutPermission,
  isExportLayoutKey,
  keepProjectAttendanceSectionIds,
} from "@/features/exports/lib/column-utils";
import { attendanceCategorySectionId, EXPORT_LAYOUT_KEYS } from "@/features/exports/types";
import { hasPermission } from "@/features/memberships/permissions";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildViewerMatrix,
  type PermissionMatrix,
} from "@/features/roles/permissions-matrix";

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

describe("настройка явочного листа", () => {
  function withSection(section: keyof PermissionMatrix, update: boolean): PermissionMatrix {
    const matrix = buildEmptyMatrix();
    matrix[section] = { ...matrix[section], access: true, read: true, update };
    return matrix;
  }
  const canSave = (matrix: PermissionMatrix) =>
    hasPermission(matrix, ATTENDANCE_SHEET_WRITE_PERMISSION);

  test("принадлежит разделу «КПП и вызывные» — как раскладки КПП", () => {
    assert.equal(ATTENDANCE_SHEET_WRITE_PERMISSION, exportLayoutPermission("kppFull", "write"));
  });

  test("сохраняет только правка «КПП и вызывные»", () => {
    assert.equal(canSave(withSection("schedule", true)), true);
    assert.equal(canSave(buildFullMatrix()), true);
  });

  test("правка отчётов или настроек проекта, просмотр КПП, «Наблюдатель» — не сохраняют", () => {
    assert.equal(canSave(withSection("reports", true)), false);
    assert.equal(canSave(withSection("project_settings", true)), false);
    assert.equal(canSave(withSection("schedule", false)), false);
    assert.equal(canSave(buildViewerMatrix()), false);
  });
});

describe("явочный лист: сохраняются только id этого проекта", () => {
  const own = attendanceCategorySectionId("cat-own");
  const foreign = attendanceCategorySectionId("cat-foreign");

  test("встроенные блоки и категории проекта остаются, порядок прежний", () => {
    assert.deepEqual(
      keepProjectAttendanceSectionIds(["scene:props", own, "special:transport"], new Set(["cat-own"])),
      ["scene:props", own, "special:transport"],
    );
  });

  test("категория другого проекта, выдуманный блок, пустой id категории и повторы — отбрасываются", () => {
    assert.deepEqual(
      keepProjectAttendanceSectionIds(
        [foreign, "scene:hacked", "resourceCategory:", "cat-own", own, own, "scene:props", "scene:props"],
        new Set(["cat-own"]),
      ),
      [own, "scene:props"],
    );
  });

  test("в проекте нет категорий — остаются только встроенные блоки", () => {
    assert.deepEqual(keepProjectAttendanceSectionIds([own, "scene:art"], new Set()), ["scene:art"]);
  });
});
