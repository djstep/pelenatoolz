import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

// Уже созданный вызывной не меняется, когда удаляют цех или участник выходит из проекта:
// в копиях — снимок названия, ФИ и телефона, связь с цехом и участником — SetNull.

const ROOT = process.cwd();
const schema = readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8").replace(/\r\n/g, "\n");

function model(name: string): string {
  const match = schema.match(new RegExp(`\\nmodel ${name} \\{\\n([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `модель ${name}`);
  return match[1]!;
}

function field(modelName: string, fieldName: string): string {
  const line = model(modelName)
    .split("\n")
    .find((l) => l.trim().split(/\s+/)[0] === fieldName);
  assert.ok(line, `${modelName}.${fieldName}`);
  return line.trim().replace(/\s+/g, " ");
}

function migrationSql(): string {
  const dir = path.join(ROOT, "prisma", "migrations");
  const name = readdirSync(dir).find((d) => d.endsWith("_call_sheet_template_profile"));
  assert.ok(name, "миграция шага 1");
  return readFileSync(path.join(dir, name, "migration.sql"), "utf8").replace(/\r\n/g, "\n");
}

describe("копии в вызывном не зависят от цеха и участника", () => {
  test("удаление цеха: в копии связь обнуляется, название остаётся", () => {
    assert.match(field("CallSheetCrewCall", "department"), /onDelete: SetNull/);
    // Название — обязательная строка самой копии, не ссылка на цех.
    assert.equal(field("CallSheetCrewCall", "label"), "label String");
    assert.match(
      migrationSql(),
      /"CallSheetCrewCall_departmentId_fkey" FOREIGN KEY \("departmentId"\) REFERENCES "Department"\("id"\) ON DELETE SET NULL/,
    );
  });

  test("участник: в копии связь обнуляется, ФИ и телефон остаются", () => {
    assert.match(field("CallSheetLeader", "membership"), /onDelete: SetNull/);
    assert.equal(field("CallSheetLeader", "personName"), "personName String?");
    assert.equal(field("CallSheetLeader", "phone"), "phone String?");
    assert.match(
      migrationSql(),
      /"CallSheetLeader_membershipId_fkey" FOREIGN KEY \("membershipId"\) REFERENCES "ProjectMembership"\("id"\) ON DELETE SET NULL/,
    );
  });

  test("выход из проекта — смена статуса, строка участия остаётся", () => {
    assert.match(model("ProjectMembership"), /status\s+MembershipStatus/);
    assert.match(schema, /enum MembershipStatus \{[^}]*REMOVED/);
    const actions = readFileSync(path.join(ROOT, "src", "features", "projects", "actions.ts"), "utf8").replace(/\r\n/g, "\n");
    assert.match(actions, /status: MembershipStatus\.REMOVED/);
    assert.doesNotMatch(actions, /projectMembership\.(delete|deleteMany)\b/);
  });

  test("шаблон: строка цеха удаляется вместе с цехом, участник — обнуляется", () => {
    assert.match(field("CallSheetTemplateCrewCall", "department"), /onDelete: Cascade/);
    assert.match(field("CallSheetTemplateLeader", "membership"), /onDelete: SetNull/);
  });

  test("копии меняет только код вызывного (не удаление цеха и не выход участника)", () => {
    const allowed = path.join("src", "features", "call-sheets", "actions.ts");
    const writes = /\b(callSheetLeader|callSheetCrewCall|callSheetBaseItem)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
          const rel = path.relative(ROOT, full);
          if (rel !== allowed && writes.test(readFileSync(full, "utf8").replace(/\r\n/g, "\n"))) offenders.push(rel);
        }
      }
    };
    walk(path.join(ROOT, "src"));
    assert.deepEqual(offenders, []);
  });
});
