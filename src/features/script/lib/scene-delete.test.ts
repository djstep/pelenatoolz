import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scenesDeleteRefusal, type SceneDeleteUsage } from "./scene-delete";

function usage(label: string, opts: Partial<SceneDeleteUsage> = {}): SceneDeleteUsage {
  return { label, cut: false, shootDays: 0, reportDays: new Set(), ...opts };
}

describe("удаление сцен: отказ", () => {
  test("сцены в днях КПП — отказ с номерами", () => {
    assert.deepEqual(
      scenesDeleteRefusal([usage("3", { shootDays: 1 }), usage("7", { shootDays: 2 })]),
      ["Сцены 3, 7 стоят в днях КПП — уберите их из дня или пометьте вырезанными"],
    );
  });

  test("вырезанная в дне — только «уберите из дня»", () => {
    assert.deepEqual(scenesDeleteRefusal([usage("2", { shootDays: 1, cut: true })]), [
      "Сцена 2 стоит в днях КПП — уберите её из дня",
    ]);
  });

  test("строки отчёта смены — отказ с числом дней", () => {
    assert.deepEqual(
      scenesDeleteRefusal([
        usage("4", { reportDays: new Set(["d1", "d2"]) }),
        usage("5", { reportDays: new Set(["d2"]) }),
      ]),
      ["Сцены 4, 5 есть в отчётах смены (2 дня) — удалить нельзя, пропадёт история съёмок"],
    );
  });

  test("отказ целиком: свободные сцены среди выбранных тоже не удаляются", () => {
    assert.deepEqual(scenesDeleteRefusal([usage("1"), usage("3", { shootDays: 1 })]), [
      "Сцена 3 стоит в днях КПП — уберите её из дня или пометьте вырезанной",
      "Удалить нельзя ни одну из выбранных — уберите эти сцены из выбора",
    ]);
  });

  test("свободные сцены (и сцена только в слоте дня — слот не в счёт) — можно", () => {
    assert.deepEqual(scenesDeleteRefusal([usage("1"), usage("2", { cut: true })]), []);
  });
});
