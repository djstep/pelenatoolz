import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canQuickCreate, type Permission } from "@/features/memberships/permissions";

const can =
  (...allowed: Permission[]) =>
  (permission: Permission) =>
    allowed.includes(permission);

describe("быстрое создание по названию — из раздела, который человек правит", () => {
  test("персонаж: из персонажей, либретто или сценария; не из объектов и не по просмотру", () => {
    for (const p of ["characters:write", "scenes:write", "screenplay:write"] as const) {
      assert.equal(canQuickCreate(can(p), "character"), true, p);
    }
    for (const p of ["locations:write", "resources:write", "characters:read", "cast:write"] as const) {
      assert.equal(canQuickCreate(can(p), "character"), false, p);
    }
  });

  test("объект и подобъект из карточки сцены: объекты или либретто, но не сценарий", () => {
    assert.equal(canQuickCreate(can("locations:write"), "location"), true);
    assert.equal(canQuickCreate(can("scenes:write"), "location"), true);
    assert.equal(canQuickCreate(can("screenplay:write"), "location"), false);
    assert.equal(canQuickCreate(can("locations:read", "scenes:read"), "location"), false);
  });

  test("место из шапки сценария: объекты или сценарий, но не либретто", () => {
    assert.equal(canQuickCreate(can("locations:write"), "place"), true);
    assert.equal(canQuickCreate(can("screenplay:write"), "place"), true);
    assert.equal(canQuickCreate(can("scenes:write"), "place"), false);
  });

  test("позиция ресурса: ресурсы или либретто", () => {
    assert.equal(canQuickCreate(can("resources:write"), "resourceItem"), true);
    assert.equal(canQuickCreate(can("scenes:write"), "resourceItem"), true);
    assert.equal(canQuickCreate(can("screenplay:write", "locations:write"), "resourceItem"), false);
  });
});
