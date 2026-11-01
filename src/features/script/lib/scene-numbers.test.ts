import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hasPermission } from "@/features/memberships/permissions";
import {
  buildEmptyMatrix,
  buildFullMatrix,
  buildViewerMatrix,
} from "@/features/roles/permissions-matrix";
import {
  applySceneNumberChanges,
  planAutoRenumber,
  planManualRenumber,
  sceneNumbersAccessRefusal,
  type SceneNumberRow,
} from "./scene-numbers";

function scene(id: string, number: string, opts: Partial<SceneNumberRow & { sortOrder: number }> = {}) {
  return { id, episodeNumber: 0, number, postfix: "", cut: false, sortOrder: 0, ...opts };
}

const label = (s: { number: string; postfix: string }) => `${s.number}${s.postfix}`;

describe("перенумерация: право", () => {
  test("без правки сценария — «Недостаточно прав» (просмотр, как у «ТЕСТ без финансов»)", () => {
    for (const matrix of [buildViewerMatrix(), buildEmptyMatrix()]) {
      assert.equal(
        sceneNumbersAccessRefusal((p) => hasPermission(matrix, p)),
        "Недостаточно прав",
      );
    }
  });

  test("продюсер — можно", () => {
    const matrix = buildFullMatrix();
    assert.equal(sceneNumbersAccessRefusal((p) => hasPermission(matrix, p)), null);
  });
});

describe("авто-перенумерация", () => {
  test("номер вырезанной пропускается, её номер прежний", () => {
    const scenes = [
      scene("a", "1", { sortOrder: 1 }),
      scene("b", "2", { sortOrder: 2, cut: true }),
      scene("c", "3", { sortOrder: 3 }),
      scene("d", "5", { sortOrder: 4 }),
    ];
    const changes = planAutoRenumber(scenes);
    assert.deepEqual(
      changes.map((c) => [c.id, label(c)]),
      [["d", "4"]],
    );
  });

  test("вырезанная со «своим» номером впереди: живые его не занимают", () => {
    const scenes = [
      scene("a", "7", { sortOrder: 1 }),
      scene("b", "1", { sortOrder: 2, cut: true }),
      scene("c", "9", { sortOrder: 3 }),
    ];
    const byId = new Map(planAutoRenumber(scenes).map((c) => [c.id, c]));
    assert.equal(label(byId.get("a")!), "2");
    assert.equal(byId.has("b"), false, "вырезанная не меняется");
    assert.equal(label(byId.get("c")!), "3");
  });

  test("буквы снимаются у живых, порядок — позиция вместе с вырезанными", () => {
    const scenes = [
      scene("a", "1", { sortOrder: 10 }),
      scene("b", "1", { postfix: "А", sortOrder: 20, cut: true }),
      scene("c", "2", { postfix: "Б", sortOrder: 30 }),
    ];
    const changes = planAutoRenumber(scenes);
    assert.deepEqual(
      changes.map((c) => [c.id, label(c), c.sortOrder]),
      [
        ["a", "1", 1],
        ["b", "1А", 2],
        ["c", "2", 3],
      ],
    );
  });

  test("серии считаются отдельно, номера вырезанных — в своей серии", () => {
    const scenes = [
      scene("a", "4", { episodeNumber: 1, sortOrder: 1 }),
      scene("b", "1", { episodeNumber: 2, sortOrder: 1, cut: true }),
      scene("c", "3", { episodeNumber: 2, sortOrder: 2 }),
    ];
    const byId = new Map(planAutoRenumber(scenes).map((c) => [c.id, c]));
    assert.equal(label(byId.get("a")!), "1");
    assert.equal(label(byId.get("c")!), "2");
  });

  test("обмен 1 ↔ 2: обе сцены в плане", () => {
    const scenes = [scene("a", "2", { sortOrder: 1 }), scene("b", "1", { sortOrder: 2 })];
    assert.deepEqual(
      planAutoRenumber(scenes).map((c) => [c.id, label(c)]),
      [
        ["a", "1"],
        ["b", "2"],
      ],
    );
  });

  test("ничего не меняется — пустой план", () => {
    assert.deepEqual(planAutoRenumber([scene("a", "1", { sortOrder: 1 })]), []);
  });
});

describe("ручная перенумерация", () => {
  const scenes = [scene("a", "1"), scene("b", "2", { cut: true }), scene("c", "3")];

  test("номер занят вырезанной — отказ с буквой, как в импорте", () => {
    const plan = planManualRenumber(scenes, [{ ...scenes[2]!, number: "2" }], "FEATURE");
    assert.deepEqual(plan, { error: "Номер 2 занят вырезанной сценой — например, 2А" });
  });

  test("буква уже занята — следующая", () => {
    const withLetter = [...scenes, scene("d", "2", { postfix: "А" })];
    const plan = planManualRenumber(withLetter, [{ ...withLetter[2]!, number: "2" }], "FEATURE");
    assert.deepEqual(plan, { error: "Номер 2 занят вырезанной сценой — например, 2Б" });
  });

  test("сериал: номер с серией", () => {
    const series = [scene("a", "1", { episodeNumber: 3 }), scene("b", "2", { episodeNumber: 3, cut: true })];
    const plan = planManualRenumber(series, [{ ...series[0]!, number: "2" }], "SERIES");
    assert.deepEqual(plan, { error: "Номер 3-2 занят вырезанной сценой — например, 3-2А" });
  });

  test("номер вырезанной сцены не меняется", () => {
    const plan = planManualRenumber(scenes, [{ ...scenes[1]!, number: "5" }], "FEATURE");
    assert.deepEqual(plan, { error: "Сцена 2 вырезана — её номер не меняется" });
  });

  test("вырезанная в списке без изменений — не мешает", () => {
    const plan = planManualRenumber(scenes, scenes, "FEATURE");
    assert.deepEqual(plan, { changes: [] });
  });

  test("обмен 1 ↔ 3 — можно, обе сцены в плане", () => {
    const plan = planManualRenumber(
      scenes,
      [
        { ...scenes[0]!, number: "3" },
        { ...scenes[2]!, number: "1" },
      ],
      "FEATURE",
    );
    assert.ok("changes" in plan);
    assert.deepEqual(
      plan.changes.map((c) => [c.id, label(c), c.sortOrder]),
      [
        ["a", "3", null],
        ["c", "1", null],
      ],
    );
  });

  test("повтор номера — отказ до записи", () => {
    const plan = planManualRenumber(scenes, [{ ...scenes[0]!, number: "3" }], "FEATURE");
    assert.deepEqual(plan, { error: "Номер 3 повторяется — проверьте уникальность" });
  });

  test("чужая сцена — отказ", () => {
    const plan = planManualRenumber(scenes, [scene("x", "9")], "FEATURE");
    assert.deepEqual(plan, { error: "Сцена не найдена" });
  });
});

describe("запись номеров: обмен через временный номер", () => {
  function fakeTx() {
    const calls: { sql: string; values: unknown[] }[] = [];
    const $executeRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve(0);
    };
    return { tx: { $executeRaw } as unknown as Parameters<typeof applySceneNumberChanges>[0], calls };
  }

  test("обмен 1 ↔ 2: сначала обеим «~id», потом новые номера — в той же транзакции", async () => {
    const current = [scene("a", "1"), scene("b", "2")];
    const { tx, calls } = fakeTx();
    await applySceneNumberChanges(
      tx,
      "p1",
      [
        { id: "a", episodeNumber: 0, number: "2", postfix: "", sortOrder: null },
        { id: "b", episodeNumber: 0, number: "1", postfix: "", sortOrder: null },
      ],
      current,
    );
    assert.equal(calls.length, 2);
    assert.match(calls[0]!.sql, /SET "number" = '~' \|\| "id"/);
    assert.deepEqual(calls[0]!.values, ["p1", ["a", "b"]]);
    assert.match(calls[1]!.sql, /FROM unnest\(/);
    assert.deepEqual(calls[1]!.values.slice(1), [["a", "b"], [0, 0], ["2", "1"], ["", ""], [null, null], "p1"]);
  });

  test("меняется только порядок — без временного номера", async () => {
    const { tx, calls } = fakeTx();
    await applySceneNumberChanges(
      tx,
      "p1",
      [{ id: "a", episodeNumber: 0, number: "1", postfix: "", sortOrder: 5 }],
      [scene("a", "1")],
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.sql, /FROM unnest\(/);
  });

  test("пустой план — ничего не пишется", async () => {
    const { tx, calls } = fakeTx();
    await applySceneNumberChanges(tx, "p1", [], [scene("a", "1")]);
    assert.equal(calls.length, 0);
  });
});
