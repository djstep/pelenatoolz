import type { ScriptBlockType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { createEmptyBlock } from "@/features/screenplay/lib/block-types";
import { blockPlainText } from "@/features/screenplay/lib/plain-text";
import { classifyScriptLines } from "@/features/script/lib/screenplay-lines";
import { isStageDirectionLine } from "@/features/screenplay/lib/stage-directions";

const STRUCTURAL_TYPES = new Set<ScriptBlockType>([
  "SLUGLINE",
  "SCENE_CAST",
  "TRANSITION",
  "SUPER",
  "NOTE",
  "BONEYARD",
  "FOLDER",
  "SCENE_GROUP",
]);

const SLUGLINE_RE =
  /^(?:\d+[\.\)]\s*)?(?:ИНТ|НАТ|INT|EXT)\b/i;
const TRANSITION_RE =
  /^(?:ПЕРЕХОД|CUT TO|FADE|DISSOLVE|ЗАТЕМНЕНИЕ)/i;

function lineTypeToBlockType(
  lineType: "action" | "character" | "parenthetical" | "dialogue",
): ScriptBlockType {
  switch (lineType) {
    case "character":
      return "CHARACTER";
    case "dialogue":
      return "DIALOGUE";
    case "parenthetical":
      return "PARENTHETICAL";
    default:
      return "ACTION";
  }
}

function detectStructuralType(text: string): ScriptBlockType | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (SLUGLINE_RE.test(trimmed)) return "SLUGLINE";
  if (TRANSITION_RE.test(trimmed) || isStageDirectionLine(trimmed)) return "TRANSITION";
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) return "BONEYARD";
  if (trimmed.startsWith("*") && trimmed.endsWith("*")) return "NOTE";
  return null;
}

function blocksToReformatText(blocks: ScreenplayBlock[]): string {
  const lines: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const text = blockPlainText(block.content, block.contentHtml);
    const paragraphs = text.split("\n");

    for (const paragraph of paragraphs) {
      if (lines.length > 0) {
        const prevType = blocks[i - 1]?.type;
        const needsBlank =
          block.type !== "DIALOGUE" &&
          block.type !== "PARENTHETICAL" &&
          prevType !== "CHARACTER";
        if (needsBlank && lines[lines.length - 1] !== "") {
          lines.push("");
        }
      }
      lines.push(paragraph);
    }
  }

  return lines.join("\n");
}

function reformatBodySegment(
  blocks: ScreenplayBlock[],
  sceneId: string | null,
  startOrder: number,
): ScreenplayBlock[] {
  if (blocks.length === 0) return [];

  const text = blocksToReformatText(blocks);
  const classified = classifyScriptLines(text);
  const result: ScreenplayBlock[] = [];
  let order = startOrder;

  for (const line of classified) {
    if (line.type === "blank") continue;
    const structural = detectStructuralType(line.text);
    const type = structural ?? lineTypeToBlockType(line.type);
    const source = blocks[0];
    result.push({
      id: `new-${crypto.randomUUID()}`,
      type,
      content: line.text,
      contentHtml: null,
      sceneId: source?.sceneId ?? sceneId,
      sortOrder: order,
    });
    order += 1;
  }

  return result;
}

/**
 * Re-run screenplay line classification on a block range (or entire document).
 * Structural blocks (sluglines, transitions, notes) are preserved when detected inline.
 */
export function reformatScreenplayBlocks(
  blocks: ScreenplayBlock[],
  rangeStart?: number,
  rangeEnd?: number,
): ScreenplayBlock[] {
  const start = rangeStart ?? 0;
  const end = rangeEnd ?? blocks.length - 1;
  if (start > end || blocks.length === 0) return blocks;

  const prefix = blocks.slice(0, start);
  const suffix = blocks.slice(end + 1);
  const slice = blocks.slice(start, end + 1);

  const output: ScreenplayBlock[] = [];
  let segment: ScreenplayBlock[] = [];
  let order = start;

  const flushSegment = () => {
    if (segment.length === 0) return;
    const sceneId = segment[0]?.sceneId ?? null;
    const reformatted = reformatBodySegment(segment, sceneId, order);
    output.push(...reformatted);
    order += reformatted.length;
    segment = [];
  };

  for (const block of slice) {
    if (STRUCTURAL_TYPES.has(block.type)) {
      flushSegment();
      output.push({ ...block, sortOrder: order });
      order += 1;
      continue;
    }
    segment.push(block);
  }
  flushSegment();

  const merged = [...prefix, ...output, ...suffix];
  return merged.map((block, index) => ({ ...block, sortOrder: index }));
}

/** Split a single messy block into properly typed blocks (paste cleanup). */
export function reformatSingleBlock(block: ScreenplayBlock): ScreenplayBlock[] {
  const results = reformatBodySegment([block], block.sceneId, block.sortOrder);
  if (results.length === 0) {
    return [createEmptyBlock(block.type, block.sortOrder, block.sceneId)];
  }
  if (results.length === 1) {
    return [{ ...results[0]!, id: block.id }];
  }
  return results.map((item, index) =>
    index === 0 ? { ...item, id: block.id } : item,
  );
}
