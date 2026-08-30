import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";

export function serializeBlocksSnapshot(blocks: ScreenplayBlock[]) {
  return JSON.stringify(
    blocks.map((block) => ({
      type: block.type,
      content: block.content,
      contentHtml: block.contentHtml ?? null,
      sceneId: block.sceneId,
      sortOrder: block.sortOrder,
    })),
  );
}

export function blocksAreEqual(a: ScreenplayBlock[], b: ScreenplayBlock[]) {
  return serializeBlocksSnapshot(a) === serializeBlocksSnapshot(b);
}
