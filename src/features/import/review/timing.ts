import type { TimingMode } from "@prisma/client";
import type { NormalizedScript } from "@/features/import/normalize/normalize-script";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { estimateSceneTiming } from "@/features/screenplay/lib/timing";
import { formatSecondsMmSs } from "@/shared/i18n/domain-labels";

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
  return { scenes, total: { seconds: total, label: formatSecondsMmSs(total) } };
}
