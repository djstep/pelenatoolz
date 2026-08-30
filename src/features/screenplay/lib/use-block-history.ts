import { useCallback, useRef, useState } from "react";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { blocksAreEqual } from "@/features/screenplay/lib/block-snapshot";

const MAX_HISTORY = 60;

export function useBlockHistory(initial: ScreenplayBlock[]) {
  const [blocks, setBlocksState] = useState(initial);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyRef = useRef<ScreenplayBlock[][]>([initial]);
  const skipRef = useRef(false);

  const setBlocks = useCallback(
    (next: ScreenplayBlock[] | ((prev: ScreenplayBlock[]) => ScreenplayBlock[])) => {
      setBlocksState((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        if (skipRef.current) {
          skipRef.current = false;
          return resolved;
        }
        if (blocksAreEqual(prev, resolved)) return resolved;

        const trimmed = historyRef.current.slice(0, historyIndex + 1);
        trimmed.push(resolved);
        const overflow = trimmed.length - MAX_HISTORY;
        const nextHistory = overflow > 0 ? trimmed.slice(overflow) : trimmed;
        historyRef.current = nextHistory;
        setHistoryIndex(nextHistory.length - 1);
        return resolved;
      });
    },
    [historyIndex],
  );

  const resetHistory = useCallback((next: ScreenplayBlock[]) => {
    historyRef.current = [next];
    setHistoryIndex(0);
    skipRef.current = true;
    setBlocksState(next);
  }, []);

  const undo = useCallback(() => {
    setHistoryIndex((idx) => {
      if (idx <= 0) return idx;
      const nextIdx = idx - 1;
      skipRef.current = true;
      setBlocksState(historyRef.current[nextIdx]!);
      return nextIdx;
    });
  }, []);

  const redo = useCallback(() => {
    setHistoryIndex((idx) => {
      if (idx >= historyRef.current.length - 1) return idx;
      const nextIdx = idx + 1;
      skipRef.current = true;
      setBlocksState(historyRef.current[nextIdx]!);
      return nextIdx;
    });
  }, []);

  return {
    blocks,
    setBlocks,
    resetHistory,
    undo,
    redo,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < historyRef.current.length - 1,
  };
}
