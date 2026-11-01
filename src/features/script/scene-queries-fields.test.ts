import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ACTOR_FIELDS,
  CHARACTER_FIELDS,
  SCENE_ACTOR_SELECT,
  SCENE_CHARACTER_SELECT,
} from "@/features/characters/lib/character-fields";
import { RESOURCE_ITEM_FIELDS, SCENE_RESOURCE_ITEM_SELECT } from "@/features/resources/lib/item-fields";

/** Ключи выборки — только открытые поля, ни одного фин. поля. */
function assertOnlyOpen(
  select: object,
  fields: { readonly open: readonly string[]; readonly finance: readonly string[] },
) {
  const keys = Object.keys(select);
  for (const key of keys) assert.ok(fields.open.includes(key), key);
  assert.deepEqual(keys.filter((key) => fields.finance.includes(key)), []);
  return keys;
}

describe("персонаж, актёр, ресурс в сценах (либретто, сценарий, КПП, вызывной)", () => {
  test("персонаж: только открытые поля, сырого снимка актёра нет", () => {
    const keys = assertOnlyOpen(SCENE_CHARACTER_SELECT, CHARACTER_FIELDS);
    assert.equal(keys.includes("castSnapshot"), false);
    for (const key of ["id", "name", "makeupOffsetMin", "costumeOffsetMin"]) {
      assert.ok(keys.includes(key), key);
    }
  });

  test("актёр в вызывном: без ставки и условий, имя и телефоны есть", () => {
    const keys = assertOnlyOpen(SCENE_ACTOR_SELECT, ACTOR_FIELDS);
    for (const key of ["shiftRate", "taxPercent", "specialConditions", "overtimeRates"]) {
      assert.equal(keys.includes(key), false, key);
    }
    for (const key of ["id", "characterId", "lastName", "phone1", "pickupOffsetMin"]) {
      assert.ok(keys.includes(key), key);
    }
  });

  test("позиция ресурса: без ставки, км и налога; название и время прибытия есть", () => {
    const keys = assertOnlyOpen(SCENE_RESOURCE_ITEM_SELECT, RESOURCE_ITEM_FIELDS);
    for (const key of ["shiftRate", "kmRate", "taxPercent"]) {
      assert.equal(keys.includes(key), false, key);
    }
    for (const key of ["id", "categoryId", "name", "arrivalOffsetMin"]) {
      assert.ok(keys.includes(key), key);
    }
  });
});

describe("выборки сцен и дня не берут полные записи", () => {
  const files = [
    "src/features/script/queries.ts",
    "src/features/schedule/queries.ts",
    "src/features/day-docs/queries.ts",
  ];

  for (const file of files) {
    const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");

    test(`${file}: персонаж, объект, актёр — не полной записью`, () => {
      assert.equal(/\b(character|location|actor)s?: true\b/.test(source), false);
      assert.equal(/include: \{ (character|location|actor)s?: true/.test(source), false);
    });

    test(`${file}: позиция ресурса — через select, не include`, () => {
      assert.equal(/\bitem: \{\s*include:/.test(source), false);
    });

    test(`${file}: списки персонажей, объектов, актёров — с select`, () => {
      for (const model of ["character", "location", "actor", "resourceItem"]) {
        const calls = source.split(`prisma.${model}.findMany({`).slice(1);
        for (const call of calls) {
          const body = call.slice(0, call.indexOf("});"));
          assert.ok(/\bselect:/.test(body), `${model}.findMany без select`);
          assert.equal(/\binclude:/.test(body.split("select:")[0]!), false, model);
        }
      }
    });
  }
});
