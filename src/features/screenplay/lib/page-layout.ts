import type { ScriptBlockType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { blockPlainText } from "@/features/screenplay/lib/plain-text";

/** Industry standard: ~55 lines of Courier 12pt per screenplay page. */
export const LINES_PER_PAGE = 55;

const CHARS_PER_LINE: Partial<Record<ScriptBlockType, number>> = {
  ACTION: 60,
  DIALOGUE: 35,
  PARENTHETICAL: 30,
  CHARACTER: 22,
  SLUGLINE: 60,
  SCENE_CAST: 60,
  TRANSITION: 40,
  SUPER: 40,
  NOTE: 60,
  BONEYARD: 60,
};

const EXTRA_LINES: Partial<Record<ScriptBlockType, number>> = {
  SLUGLINE: 2,
  CHARACTER: 1,
  TRANSITION: 1,
  SCENE_GROUP: 1,
};

export function estimateBlockLines(block: ScreenplayBlock): number {
  const text = blockPlainText(block.content, block.contentHtml);
  const maxChars = CHARS_PER_LINE[block.type] ?? 60;
  let lines = 0;

  if (!text.trim()) {
    lines = 1;
  } else {
    for (const paragraph of text.split("\n")) {
      if (!paragraph.trim()) lines += 1;
      else lines += Math.max(1, Math.ceil(paragraph.length / maxChars));
    }
  }

  lines += EXTRA_LINES[block.type] ?? 0;
  return Math.max(1, lines);
}

export type PageBreakMarker = {
  afterBlockIndex: number;
  pageNumber: number;
};

export function computePageBreaks(blocks: ScreenplayBlock[]): PageBreakMarker[] {
  const breaks: PageBreakMarker[] = [];
  let lineCount = 0;
  let page = 1;

  blocks.forEach((block, index) => {
    lineCount += estimateBlockLines(block);
    if (lineCount >= LINES_PER_PAGE) {
      breaks.push({ afterBlockIndex: index, pageNumber: page });
      page += 1;
      lineCount = 0;
    }
  });

  return breaks;
}

export function estimateTotalPages(blocks: ScreenplayBlock[]): number {
  const totalLines = blocks.reduce((sum, block) => sum + estimateBlockLines(block), 0);
  return Math.max(1, Math.ceil(totalLines / LINES_PER_PAGE));
}
