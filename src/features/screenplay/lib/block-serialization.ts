import type { ScriptBlockType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { blockPlainText } from "@/features/screenplay/lib/plain-text";
import { classifyScriptLines } from "@/features/script/lib/screenplay-lines";

export function scriptContentToBlocks(
  scriptContent: string | null | undefined,
  sceneId: string,
  startOrder: number,
): ScreenplayBlock[] {
  if (!scriptContent?.trim()) return [];

  const lines = classifyScriptLines(scriptContent);
  const blocks: ScreenplayBlock[] = [];
  let order = startOrder;

  for (const line of lines) {
    if (line.type === "blank") continue;
    let type: ScriptBlockType = "ACTION";
    if (line.type === "character") type = "CHARACTER";
    else if (line.type === "dialogue") type = "DIALOGUE";
    else if (line.type === "parenthetical") type = "PARENTHETICAL";

    blocks.push({
      id: `legacy-${sceneId}-${order}`,
      type,
      content: line.text,
      sceneId,
      sortOrder: order,
    });
    order += 1;
  }

  return blocks;
}

export function blocksToScriptContent(blocks: ScreenplayBlock[]) {
  const bodyTypes = new Set<ScriptBlockType>([
    "ACTION",
    "CHARACTER",
    "DIALOGUE",
    "PARENTHETICAL",
    "SUPER",
    "TRANSITION",
    "SCENE_CAST",
  ]);

  return blocks
    .filter((block) => bodyTypes.has(block.type) && blockPlainText(block.content, block.contentHtml).trim())
    .map((block) => blockPlainText(block.content, block.contentHtml).trim())
    .join("\n");
}

export function extractCharacterNames(blocks: ScreenplayBlock[]) {
  const names = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "CHARACTER") continue;
    const name = blockPlainText(block.content, block.contentHtml).trim().replace(/\.+$/, "");
    if (name) names.add(name.toUpperCase());
  }
  return [...names];
}
