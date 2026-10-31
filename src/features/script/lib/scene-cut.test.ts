import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { KppExportDay, KppExportScene } from "@/features/schedule/lib/kpp-export-data";
import { getKppFullCellValue } from "@/features/schedule/lib/kpp-export-cells";
import { estimateScreenplayTiming } from "@/features/screenplay/lib/timing";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { buildLibrettoExportCell } from "@/features/script/lib/libretto-cell-values";
import type { LibrettoScene } from "@/features/script/lib/libretto-display";
import { applyLibrettoFilters, emptyFilters } from "@/features/script/lib/libretto-filters";

/** Сцена либретто с нужными для проверок полями; остальное фильтрам и ячейкам не нужно. */
function librettoScene(id: string, number: string, cutAt: Date | null): LibrettoScene {
  return {
    id,
    number,
    postfix: "",
    episodeNumber: 0,
    cutAt,
    summary: null,
    description: null,
    title: null,
    status: "PLANNING",
    sceneKind: "SCENE",
    dayNight: null,
    scriptDay: null,
    shootingUnit: null,
    locations: [],
    characters: [],
    resourceItems: [],
    resources: [],
    elements: [],
    shootDayScenes: [],
    shootAttempts: [],
  } as unknown as LibrettoScene;
}

const fmt = (s: LibrettoScene) => s.number;

describe("статус «вырезана»", () => {
  const scenes = [
    librettoScene("a", "1", null),
    librettoScene("b", "2", new Date("2026-10-30")),
    librettoScene("c", "3", null),
  ];

  test("либретто: вырезанные скрыты по умолчанию", () => {
    const shown = applyLibrettoFilters(scenes, emptyFilters(), fmt).map((s) => s.number);
    assert.deepEqual(shown, ["1", "3"]);
  });

  test("либретто: «Показать вырезанные» показывает их", () => {
    const shown = applyLibrettoFilters(scenes, { ...emptyFilters(), showCut: true }, fmt);
    assert.deepEqual(shown.map((s) => s.number), ["1", "2", "3"]);
  });

  test("либретто: остальные фильтры работают и для вырезанных", () => {
    const shown = applyLibrettoFilters(
      scenes,
      { ...emptyFilters(), showCut: true, sceneFrom: "2", sceneTo: "2" },
      fmt,
    );
    assert.deepEqual(shown.map((s) => s.number), ["2"]);
  });

  test("выгрузка либретто: у вырезанной — пометка у номера", () => {
    assert.equal(buildLibrettoExportCell(scenes[1]!, ["number"], "FEATURE"), "2 (вырезана)");
    assert.equal(buildLibrettoExportCell(scenes[0]!, ["number"], "FEATURE"), "1");
  });

  test("выгрузка КПП: у вырезанной в дне — пометка у номера", () => {
    const day = { id: "d", dayNumber: 1, date: new Date("2026-12-01") } as KppExportDay;
    const scene = (cutAt: Date | null) =>
      ({ number: "12", postfix: "А", episodeNumber: 0, cutAt }) as KppExportScene;
    const cell = (cutAt: Date | null) =>
      getKppFullCellValue(
        { kind: "scene", day, scene: scene(cutAt), linkNotes: null },
        "sceneNumber",
        "FEATURE",
        { showWeekday: false },
      );
    assert.equal(cell(new Date()), "12А (вырезана)");
    assert.equal(cell(null), "12А");
  });

  test("итог хронометража: без вырезанных сцен, формула та же", () => {
    const block = (id: string, sceneId: string, content: string): ScreenplayBlock => ({
      id,
      type: "ACTION",
      content,
      contentHtml: null,
      sceneId,
      sortOrder: 0,
    });
    const blocks = [block("1", "a", "раз два три четыре"), block("2", "b", "пять шесть")];
    const timings = [
      { sceneId: "a", planSeconds: 30 },
      { sceneId: "b", planSeconds: 20, cut: true },
    ];
    assert.equal(estimateScreenplayTiming(blocks, "MANUAL", 1, timings).seconds, 30);
    // По словам (MINUTES): 4 слова / 2 = 2 с; без пометки — 6 слов / 2 = 3 с
    assert.equal(estimateScreenplayTiming(blocks, "MINUTES", 1, timings).seconds, 2);
    assert.equal(
      estimateScreenplayTiming(blocks, "MINUTES", 1, timings.map((t) => ({ ...t, cut: false })))
        .seconds,
      3,
    );
  });
});
