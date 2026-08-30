import type { DayNight, IntExt, TimingMode } from "@prisma/client";
import type { ScreenplayBlock } from "@/features/screenplay/lib/block-types";
import { blocksToScriptContent, extractCharacterNames } from "@/features/screenplay/lib/block-serialization";
import { parseSlugline } from "@/features/screenplay/lib/slugline";
import { estimateSceneTiming } from "@/features/screenplay/lib/timing";
import type { ImportPreviewScene } from "@/features/import/types";

type ExistingScene = {
  id: string;
  episodeNumber: number;
  number: string;
  postfix: string;
  intExt: IntExt | null;
  dayNight: DayNight | null;
  scriptDay: number | null;
  planSeconds: number | null;
  scriptContent: string | null;
  summary: string | null;
  locations: { location: { name: string } }[];
  characters: { character: { name: string } }[];
};

function formatSeconds(sec: number | null | undefined) {
  if (sec == null) return undefined;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function splitBlocksByScenes(blocks: ScreenplayBlock[]) {
  const scenes: Array<{ slugline: ScreenplayBlock; body: ScreenplayBlock[] }> = [];
  let current: { slugline: ScreenplayBlock; body: ScreenplayBlock[] } | null = null;

  for (const block of [...blocks].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (block.type === "SLUGLINE") {
      if (current) scenes.push(current);
      current = { slugline: block, body: [] };
      continue;
    }
    if (!current) continue;
    current.body.push(block);
  }
  if (current) scenes.push(current);
  return scenes;
}

export function buildLibrettoPreviewFromBlocks(
  blocks: ScreenplayBlock[],
  existingScenes: ExistingScene[],
  timingMode: TimingMode = "MINUTES",
  pageToMinuteRatio = 1,
): ImportPreviewScene[] {
  const sceneGroups = splitBlocksByScenes(blocks);

  return sceneGroups.map((group, idx) => {
    const parsed = parseSlugline(group.slugline.content);
    const castBlock = group.body.find((b) => b.type === "SCENE_CAST");
    const characters = castBlock
      ? castBlock.content
          .split(/[,;]/)
          .map((name) => name.trim())
          .filter(Boolean)
      : extractCharacterNames(group.body);

    const scriptBlocks = group.body.filter(
      (b) => b.type !== "SCENE_CAST" && b.type !== "SLUGLINE",
    );
    const script = blocksToScriptContent(scriptBlocks) || undefined;
    const episodeNumber = parsed?.episodeNumber ?? 0;
    const number = parsed?.number ?? String(idx + 1);
    const postfix = parsed?.postfix ?? "";
    const key = `${episodeNumber}-${number}-${postfix}-${idx}`;

    const match = existingScenes.find(
      (scene) =>
        scene.number === number &&
        (scene.postfix ?? "") === postfix &&
        (scene.episodeNumber ?? 0) === episodeNumber,
    );

    const sceneTiming = estimateSceneTiming(
      [group.slugline, ...group.body],
      timingMode,
      pageToMinuteRatio,
      match?.planSeconds,
      script ?? match?.scriptContent,
    );

    const row: ImportPreviewScene = {
      key,
      episodeNumber,
      number,
      postfix,
      location: parsed?.location,
      intExt: parsed?.intExt,
      dayNight: parsed?.dayNight,
      characters,
      script,
      timing: sceneTiming.label,
    };

    if (match) {
      row.existingId = match.id;
      row.old = {
        location: match.locations[0]?.location.name ?? match.summary ?? undefined,
        intExt: match.intExt,
        characters: match.characters.map((c) => c.character.name),
        timing: formatSeconds(match.planSeconds),
        scriptDay: match.scriptDay,
        dayNight: match.dayNight,
        script: match.scriptContent,
      };
    }

    return row;
  });
}

export type LibrettoSyncResult = {
  created: number;
  updated: number;
  skipped: number;
};
