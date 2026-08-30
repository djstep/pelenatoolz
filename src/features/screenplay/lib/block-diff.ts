import type { ScriptBlockType } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { SCRIPT_BLOCK_LABELS } from "@/features/screenplay/lib/block-types";

export type BlockDiffKind = "added" | "removed" | "modified" | "unchanged";

export type BlockDiffItem = {
  kind: BlockDiffKind;
  indexA: number | null;
  indexB: number | null;
  blockA: ScreenplayBlock | null;
  blockB: ScreenplayBlock | null;
};

export type BlockDiffSummary = {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  scenesAdded: number;
  scenesRemoved: number;
  scenesModified: number;
};

type Fingerprint = {
  type: ScriptBlockType;
  content: string;
};

function fingerprint(block: ScreenplayBlock): string {
  return `${block.type}\u0000${block.content}`;
}

function toFp(block: ScreenplayBlock): Fingerprint {
  return { type: block.type, content: block.content };
}

function isModified(a: Fingerprint, b: Fingerprint) {
  return a.type !== b.type || a.content !== b.content;
}

function lcsDiff(a: ScreenplayBlock[], b: ScreenplayBlock[]) {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (fingerprint(a[i]!) === fingerprint(b[j]!)) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const items: BlockDiffItem[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (fingerprint(a[i]!) === fingerprint(b[j]!)) {
      items.push({
        kind: "unchanged",
        indexA: i,
        indexB: j,
        blockA: a[i]!,
        blockB: b[j]!,
      });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      items.push({
        kind: "removed",
        indexA: i,
        indexB: null,
        blockA: a[i]!,
        blockB: null,
      });
      i += 1;
    } else {
      items.push({
        kind: "added",
        indexA: null,
        indexB: j,
        blockA: null,
        blockB: b[j]!,
      });
      j += 1;
    }
  }

  while (i < n) {
    items.push({
      kind: "removed",
      indexA: i,
      indexB: null,
      blockA: a[i]!,
      blockB: null,
    });
    i += 1;
  }

  while (j < m) {
    items.push({
      kind: "added",
      indexA: null,
      indexB: j,
      blockA: null,
      blockB: b[j]!,
    });
    j += 1;
  }

  return items;
}

function mergeModifiedNeighbors(items: BlockDiffItem[]) {
  const merged: BlockDiffItem[] = [];
  for (let index = 0; index < items.length; index++) {
    const current = items[index]!;
    if (
      current.kind === "removed" &&
      items[index + 1]?.kind === "added" &&
      isModified(toFp(current.blockA!), toFp(items[index + 1]!.blockB!))
    ) {
      merged.push({
        kind: "modified",
        indexA: current.indexA,
        indexB: items[index + 1]!.indexB,
        blockA: current.blockA,
        blockB: items[index + 1]!.blockB,
      });
      index += 1;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function countSluglineChanges(items: BlockDiffItem[]) {
  let scenesAdded = 0;
  let scenesRemoved = 0;
  let scenesModified = 0;

  for (const item of items) {
    const typeA = item.blockA?.type;
    const typeB = item.blockB?.type;
    if (item.kind === "added" && typeB === "SLUGLINE") scenesAdded += 1;
    if (item.kind === "removed" && typeA === "SLUGLINE") scenesRemoved += 1;
    if (item.kind === "modified" && (typeA === "SLUGLINE" || typeB === "SLUGLINE")) {
      scenesModified += 1;
    }
  }

  return { scenesAdded, scenesRemoved, scenesModified };
}

export function diffScriptBlocks(
  blocksA: ScreenplayBlock[],
  blocksB: ScreenplayBlock[],
) {
  const items = mergeModifiedNeighbors(lcsDiff(blocksA, blocksB));
  const summary: BlockDiffSummary = {
    added: items.filter((item) => item.kind === "added").length,
    removed: items.filter((item) => item.kind === "removed").length,
    modified: items.filter((item) => item.kind === "modified").length,
    unchanged: items.filter((item) => item.kind === "unchanged").length,
    ...countSluglineChanges(items),
  };

  return { items, summary };
}

export function diffChangeIndices(items: BlockDiffItem[]) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind !== "unchanged")
    .map(({ index }) => index);
}

export function blockDiffLabel(block: ScreenplayBlock | null) {
  if (!block) return "";
  return SCRIPT_BLOCK_LABELS[block.type] ?? block.type;
}
