import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseNavSections } from "@/features/projects/lib/nav-sections";

describe("parseNavSections", () => {
  test("обычное значение читается как есть, неизвестные ключи не мешают", () => {
    assert.deepEqual(parseNavSections('{"finance":false,"planning":true,"reports":true}'), {
      finance: false,
      planning: true,
      reports: true,
    });
  });

  test("ничего не сохранено", () => {
    assert.deepEqual(parseNavSections(null), {});
    assert.deepEqual(parseNavSections(""), {});
  });

  for (const raw of ["null", "[]", "[1,2]", "5", "true", '"строка"', "{битый", "undefined"]) {
    test(`не объект или битый JSON: ${raw}`, () => {
      const stored = parseNavSections(raw);
      assert.deepEqual(stored, {});
      assert.equal(stored["finance"], undefined);
    });
  }

  test("значения не true/false отбрасываются", () => {
    assert.deepEqual(parseNavSections('{"finance":"да","planning":1,"post":null,"settings":false}'), {
      settings: false,
    });
  });
});
