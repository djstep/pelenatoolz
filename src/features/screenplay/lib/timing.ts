import type { TimingMode } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { NON_PRINTABLE_BLOCK_TYPES } from "@/features/screenplay/lib/block-types";
import { estimateTotalPages } from "@/features/screenplay/lib/page-layout";
import { blockPlainText } from "@/features/screenplay/lib/plain-text";

const TIMING_BLOCK_TYPES = new Set([
  "ACTION",
  "DIALOGUE",
  "CHARACTER",
  "PARENTHETICAL",
  "SUPER",
  "SCENE_CAST",
  "SLUGLINE",
  "SCENE_GROUP",
]);

export type SceneTimingRef = {
  sceneId: string;
  planSeconds: number | null;
};

function formatMmSs(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timingText(blocks: ScreenplayBlock[]) {
  return blocks
    .filter(
      (block) =>
        TIMING_BLOCK_TYPES.has(block.type) &&
        !NON_PRINTABLE_BLOCK_TYPES.has(block.type),
    )
    .map((block) => blockPlainText(block.content, block.contentHtml))
    .join("\n");
}

function sumScenePlanSeconds(
  blocks: ScreenplayBlock[],
  sceneTimings: SceneTimingRef[],
) {
  const sceneIds = new Set(
    blocks.map((block) => block.sceneId).filter((id): id is string => Boolean(id)),
  );
  let total = 0;
  for (const ref of sceneTimings) {
    if (!sceneIds.has(ref.sceneId)) continue;
    if (ref.planSeconds != null) total += ref.planSeconds;
  }
  return total;
}

/** Extract (MM:SS) marker from scene script text, as stored during file import. */
export function extractImportedTimingSeconds(script?: string | null) {
  if (!script) return null;
  const match = script.match(/\((\d{1,2}):(\d{2})\)/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return minutes * 60 + seconds;
}

function calcByWords(blocks: ScreenplayBlock[]) {
  const text = timingText(blocks);
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(words / 2);
}

function calcByPages(
  blocks: ScreenplayBlock[],
  pageToMinuteRatio: number,
) {
  const pages = estimateTotalPages(blocks);
  return Math.round(pages * pageToMinuteRatio * 60);
}

export function estimateScreenplayTiming(
  blocks: ScreenplayBlock[],
  timingMode: TimingMode,
  pageToMinuteRatio: number,
  sceneTimings: SceneTimingRef[] = [],
) {
  if (timingMode === "MANUAL") {
    const seconds = sumScenePlanSeconds(blocks, sceneTimings);
    return { seconds, label: formatMmSs(seconds), pages: 0 };
  }

  if (timingMode === "IMPORTED") {
    const fromScenes = sumScenePlanSeconds(blocks, sceneTimings);
    if (fromScenes > 0) {
      return { seconds: fromScenes, label: formatMmSs(fromScenes), pages: 0 };
    }
    const text = timingText(blocks);
    const imported = extractImportedTimingSeconds(text);
    if (imported != null) {
      return { seconds: imported, label: formatMmSs(imported), pages: 0 };
    }
    const seconds = calcByWords(blocks);
    return { seconds, label: formatMmSs(seconds), pages: 0 };
  }

  if (timingMode === "PAGES") {
    const pages = estimateTotalPages(blocks);
    const seconds = calcByPages(blocks, pageToMinuteRatio);
    return { seconds, label: formatMmSs(seconds), pages };
  }

  const seconds = calcByWords(blocks);
  return { seconds, label: formatMmSs(seconds), pages: 0 };
}

export function estimateSceneTiming(
  blocks: ScreenplayBlock[],
  timingMode: TimingMode,
  pageToMinuteRatio: number,
  scenePlanSeconds?: number | null,
  scriptText?: string | null,
) {
  if (timingMode === "MANUAL") {
    const seconds = scenePlanSeconds ?? 0;
    return { seconds, label: formatMmSs(seconds), pages: 0 };
  }

  if (timingMode === "IMPORTED") {
    if (scenePlanSeconds != null && scenePlanSeconds > 0) {
      return {
        seconds: scenePlanSeconds,
        label: formatMmSs(scenePlanSeconds),
        pages: 0,
      };
    }
    const imported = extractImportedTimingSeconds(scriptText);
    if (imported != null) {
      return { seconds: imported, label: formatMmSs(imported), pages: 0 };
    }
  }

  return estimateScreenplayTiming(blocks, timingMode, pageToMinuteRatio);
}

export function timingModeHint(
  timingMode: TimingMode,
  pageToMinuteRatio: number,
) {
  switch (timingMode) {
    case "PAGES":
      return `По страницам (1 стр. = ${pageToMinuteRatio} мин)`;
    case "IMPORTED":
      return "Из импортированного файла";
    case "MANUAL":
      return "Ручной ввод по сценам";
    default:
      return "По словам (~2 слова/сек)";
  }
}
