import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  editDistance,
  pairKey,
  pairMembers,
  similarReason,
} from "@/features/import/normalize/similar";

describe("похожие имена", () => {
  test("расстояние редактирования", () => {
    assert.equal(editDistance("МАРИЯ", "МАРИНА"), 2);
    assert.equal(editDistance("ДИАНА", "ДИАННА"), 1);
    assert.equal(editDistance("КОМНАТА", "КОМНАТА"), 0);
    assert.equal(editDistance("АБВГД", "ЕЖЗИК", 2), 3);
    assert.equal(editDistance("", "ДОМ"), 3);
  });

  test("расстояние ≤ 2 — только при длине от 5 букв; МАРИЯ ~ МАРИНА — ложная пара, но предлагается", () => {
    assert.equal(similarReason("МАРИЯ", "МАРИНА", "character"), "distance");
    assert.equal(similarReason("МАША", "МАРА", "character"), null);
    assert.equal(similarReason("ВИКТОРИЯ", "ВАЛЕРИЯ", "character"), null);
  });

  test("одно — начало другого, до пробела или дефиса", () => {
    assert.equal(similarReason("МАША", "МАША ПЕТРОВА", "character"), "prefix");
    assert.equal(
      similarReason("АДМИНИСТРАТОР", "АДМИНИСТРАТОР-ПОМОЩНИК", "character"),
      "prefix",
    );
    assert.equal(similarReason("ИВАН", "ИВАНОВ", "character"), null);
  });

  test("имена, отличающиеся только числом, — не пара", () => {
    assert.equal(similarReason("СТАЖЕР1", "СТАЖЕР", "character"), null);
    assert.equal(similarReason("СТАЖЕР 1", "СТАЖЕР", "character"), null);
    assert.equal(similarReason("СТАЖЕР 1", "СТАЖЕР 2", "character"), null);
  });

  test("правило слов — только у локаций: окончание до 2 букв, слова от 3 букв", () => {
    assert.equal(similarReason("ДВОР ДОМА", "ДОМ", "location"), "word");
    assert.equal(similarReason("ЗАГОРОДНЫЙ ДОМ", "ДВОР ДОМА", "location"), "word");
    assert.equal(similarReason("ДВОР ДОМА", "ДОМ", "character"), null);
    assert.equal(similarReason("ДОМ", "ДОМИНО", "location"), null);
    assert.equal(similarReason("ОФИС ПО ПРОДАЖАМ", "ЦЕХ ПО РЕМОНТУ", "location"), null);
  });

  test("ключ пары — по порядку, разбирается обратно", () => {
    assert.equal(pairKey("ДОМ", "ДВОР ДОМА"), "ДВОР ДОМА|ДОМ");
    assert.equal(pairKey("ДВОР ДОМА", "ДОМ"), "ДВОР ДОМА|ДОМ");
    assert.deepEqual(pairMembers("ДВОР ДОМА|ДОМ"), ["ДВОР ДОМА", "ДОМ"]);
    assert.equal(pairMembers("ДОМ"), null);
  });
});
