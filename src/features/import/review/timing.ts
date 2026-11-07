import type { TimingMode } from "@prisma/client";
import type { NormalizedScript } from "@/features/import/normalize/normalize-script";
import type { ExistingScene } from "@/features/import/normalize/scene-match";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { estimateSceneTiming } from "@/features/screenplay/lib/timing";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";

/**
 * Хронометраж предпросмотра — по режиму проекта той же функцией, что синхронизация
 * сценарий → либретто (`estimateSceneTiming`), по нормализованным блокам сцены.
 * Время из шапки главнее: метки в тексте сцены не читаются, «(12:30)» в ремарке — не хронометраж.
 */
export function previewTimings(
  result: Pick<NormalizedScript, "blocks" | "scenes">,
  mode: TimingMode,
  pageToMinuteRatio: number,
) {
  const byScene = new Map<number, ScreenplayBlock[]>();
  result.blocks.forEach((block, sortOrder) => {
    if (block.sceneIndex == null) return;
    const list = byScene.get(block.sceneIndex) ?? [];
    list.push({
      id: String(block.paragraphIndex),
      type: block.type,
      content: block.text,
      sceneId: null,
      sortOrder,
    });
    byScene.set(block.sceneIndex, list);
  });

  const scenes = result.scenes.map((scene) => {
    const blocks = byScene.get(scene.index) ?? [];
    return estimateSceneTiming(blocks, mode, pageToMinuteRatio, scene.fileSeconds);
  });
  const total = scenes.reduce((sum, t) => sum + t.seconds, 0);
  return { scenes, total: { seconds: total, label: formatSecondsMmSs(total) } };
}

/** Экран проверки: у совпавшей сцены без записи показывается её план — он и останется в либретто. */
export function reviewTimings(
  result: Pick<NormalizedScript, "blocks" | "scenes" | "sceneMatches" | "timingUpdates">,
  mode: TimingMode,
  pageToMinuteRatio: number,
  existingScenes: readonly ExistingScene[],
) {
  const preview = previewTimings(result, mode, pageToMinuteRatio);
  const plans = new Map(existingScenes.map((scene) => [scene.id, scene.planSeconds ?? null]));
  const updated = new Set(result.timingUpdates.map((update) => update.sceneIndex));
  const scenes = result.scenes.map((scene, i) => {
    const match = result.sceneMatches[scene.index];
    const kept =
      match?.existingId && !match.pending && !updated.has(scene.index)
        ? (plans.get(match.existingId) ?? null)
        : null;
    if (kept == null) return preview.scenes[i]!;
    return { seconds: kept, label: formatSecondsMmSs(kept) };
  });
  const total = scenes.reduce((sum, t) => sum + t.seconds, 0);
  return { scenes, total: { seconds: total, label: formatSecondsMmSs(total) } };
}
