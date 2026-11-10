import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { hasPermission, type Permission } from "@/features/memberships/permissions";
import { canEntityFinance, parsePermissionMatrix } from "@/features/roles/permissions-matrix";
import {
  normalizeRoleNameForMatch,
  presetPermissionsDocument,
  ROLE_PRESETS,
  type RolePresetKey,
} from "@/features/roles/role-presets";
import { DEFAULT_ROLE_NAMES } from "@/features/roles/default-roles";

const MIGRATION = path.join(process.cwd(), "prisma/migrations/20261111140000_role_presets/migration.sql");

type Row = { key: string; name: string; note: string; permissions: unknown };

function migrationRows(): Row[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const re = /\('([a-z_]+)', '((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'::jsonb, \d+\)/g;
  const un = (s: string) => s.replace(/''/g, "'");
  return [...sql.matchAll(re)].map((m) => ({
    key: m[1]!,
    name: un(m[2]!),
    note: un(m[3]!),
    permissions: JSON.parse(un(m[4]!)),
  }));
}

describe("миграция шаблонов ролей = шаблоны в коде", () => {
  test("те же ключи, названия, описания и права", () => {
    const rows = migrationRows();
    assert.equal(rows.length, ROLE_PRESETS.length);
    for (const preset of ROLE_PRESETS) {
      const row = rows.find((r) => r.key === preset.key);
      assert.ok(row, preset.key);
      assert.equal(row.name, preset.name);
      assert.equal(row.note, preset.note);
      assert.deepEqual(row.permissions, presetPermissionsDocument(preset), preset.key);
    }
  });
});

describe("шаблоны ролей", () => {
  test("ключи и названия уникальны, системные названия не заняты", () => {
    assert.equal(new Set(ROLE_PRESETS.map((p) => p.key)).size, ROLE_PRESETS.length);
    const names = ROLE_PRESETS.map((p) => normalizeRoleNameForMatch(p.name));
    assert.equal(new Set(names).size, names.length);
    for (const reserved of Object.values(DEFAULT_ROLE_NAMES)) {
      assert.ok(!names.includes(normalizeRoleNameForMatch(reserved)), reserved);
    }
  });

  test("сравнение названий: пробелы по краям, регистр, ё = е", () => {
    assert.equal(normalizeRoleNameForMatch("  2-Й РЕЖИССЕР "), normalizeRoleNameForMatch("2-й режиссёр"));
  });

  test("ни у одного шаблона: роли и участники, настройки проекта, настройки смет, снятие фиксации", () => {
    for (const preset of ROLE_PRESETS) {
      const m = parsePermissionMatrix(presetPermissionsDocument(preset));
      for (const p of ["members:read", "members:manage", "project:read", "project:write", "smeta:settings", "finance:unlock", "post:write"] as Permission[]) {
        assert.equal(hasPermission(m, p), false, `${preset.key}: ${p}`);
      }
      // Всем — команда без контактов как минимум.
      assert.equal(hasPermission(m, "crew:read"), true, preset.key);
    }
  });

  /** Что должно быть у каждой роли — по таблице шага 0 с ответами владельца. Остальное — выключено. */
  const EXPECTED: Record<RolePresetKey, Permission[]> = {
    director: ["screenplay:read", "screenplay:write", "cast:read", "cast:write", "scenes:read", "schedule:read", "callsheet:read", "locations:read", "characters:read", "calendar:read", "crew:read"],
    second_director: ["scenes:read", "scenes:write", "schedule:read", "schedule:write", "callsheet:read", "callsheet:write", "callsheet:approve", "characters:read", "characters:write", "calendar:read", "calendar:write", "report:read", "report:write", "screenplay:read", "cast:read", "locations:read", "crew:read", "crew:contacts"],
    clapper: ["report:read", "report:write", "screenplay:read", "scenes:read", "schedule:read", "callsheet:read", "calendar:read", "crew:read"],
    dop: ["screenplay:read", "scenes:read", "schedule:read", "callsheet:read", "locations:read", "calendar:read", "crew:read"],
    production_designer: ["locations:read", "locations:write", "screenplay:read", "scenes:read", "schedule:read", "callsheet:read", "calendar:read", "crew:read"],
    costume_designer: ["screenplay:read", "scenes:read", "characters:read", "schedule:read", "callsheet:read", "calendar:read", "crew:read"],
    makeup_artist: ["screenplay:read", "scenes:read", "characters:read", "schedule:read", "callsheet:read", "calendar:read", "crew:read"],
    production_manager: ["contracts:read", "contracts:write", "crew:read", "crew:write", "crew:contacts", "locations:read", "locations:write", "resources:read", "resources:write", "calendar:read", "calendar:write", "smeta:read_all", "finance:read", "schedule:read", "callsheet:read"],
    line_producer: ["contracts:read", "contracts:write", "finance:read", "finance:write", "smeta:read_all", "smeta:return", "screenplay:read", "scenes:read", "schedule:read", "callsheet:read", "report:read", "cast:read", "characters:read", "locations:read", "resources:read", "calendar:read", "crew:read", "crew:contacts", "post:read"],
  };

  test("каждый шаблон даёт ровно свои права", () => {
    const ALL = Object.values(EXPECTED).flat();
    const everything = [...new Set([...ALL, "members:read", "members:manage", "project:read", "project:write", "project:archive", "smeta:settings", "finance:unlock", "post:write"])] as Permission[];
    for (const preset of ROLE_PRESETS) {
      const m = parsePermissionMatrix(presetPermissionsDocument(preset));
      const own = new Set(EXPECTED[preset.key]);
      for (const p of everything) {
        assert.equal(hasPermission(m, p), own.has(p), `${preset.key}: ${p}`);
      }
    }
  });

  test("ставки: директор — объекты и ресурсы (просмотр и правка), линейный — только просмотр, остальные — нет", () => {
    for (const preset of ROLE_PRESETS) {
      const doc = presetPermissionsDocument(preset);
      const m = parsePermissionMatrix(doc);
      const fin = (target: "actors" | "locations" | { categoryId: string }, mode: "read" | "write") =>
        canEntityFinance(m, {}, target, mode);
      const res = { categoryId: "any" };
      if (preset.key === "production_manager") {
        assert.deepEqual([fin("locations", "read"), fin("locations", "write"), fin(res, "read"), fin(res, "write"), fin("actors", "read")], [true, true, true, true, false]);
      } else if (preset.key === "line_producer") {
        assert.deepEqual([fin("actors", "read"), fin("locations", "read"), fin(res, "read"), fin("actors", "write"), fin("locations", "write"), fin(res, "write")], [true, true, true, false, false, false]);
      } else {
        for (const target of ["actors", "locations", res] as const) {
          assert.equal(fin(target, "read"), false, `${preset.key}`);
        }
      }
    }
  });

  test("смета своего цеха — у оператора и художников (выбор цеха в приглашении)", () => {
    const heads = ROLE_PRESETS.filter((p) => p.departmentHead).map((p) => p.key).sort();
    assert.deepEqual(heads, ["costume_designer", "dop", "makeup_artist", "production_designer"]);
  });
});
