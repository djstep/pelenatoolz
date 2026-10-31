import type { TimingMode } from "@prisma/client";
import type { NormalizedScript } from "@/features/import/normalize/normalize-script";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { estimateSceneTiming } from "@/features/screenplay/lib/timing";

export function formatMmSs(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Хронометраж предпросмотра — по режиму проекта той же функцией, что синхронизация
 * сценарий → либретто (`estimateSceneTiming`), по нормализованным блокам сцены.
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
    const text = blocks.map((b) => b.content).join("\n");
    return estimateSceneTiming(blocks, mode, pageToMinuteRatio, null, text);
  });
  const total = scenes.reduce((sum, t) => sum + t.seconds, 0);
  return { scenes, total: { seconds: total, label: formatMmSs(total) } };
}
