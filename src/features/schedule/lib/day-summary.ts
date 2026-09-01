import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
} from "@/shared/i18n/domain-labels";

type DecimalLike = number | { toString(): string } | null | undefined;

type SceneLike = {
  number: string;
  postfix?: string;
  episodeNumber?: number;
  title?: string | null;
  intExt?: keyof typeof intExtLabels | null;
  dayNight?: keyof typeof dayNightLabels | null;
  pageCount?: DecimalLike;
  planSeconds?: number | null;
  status?: string;
  locations?: { location: { name: string } }[];
  characters?: { character: { name: string } }[];
};

type DaySceneRow = {
  estimatedPages?: DecimalLike;
  scene: SceneLike;
};

export function formatSceneBrief(scene: SceneLike): string {
  const ep = scene.episodeNumber && scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  const num = `${ep}${scene.number}${scene.postfix ?? ""}`;
  const parts = [num];
  const location = scene.locations?.[0]?.location.name;
  if (location) parts.push(location);
  if (scene.intExt) parts.push(intExtLabels[scene.intExt]);
  if (scene.dayNight) parts.push(dayNightLabels[scene.dayNight]);
  return parts.join(" · ");
}

export function formatPagesMinutes(
  pages: DecimalLike,
  planSeconds: number | null | undefined,
): string {
  const pageStr =
    pages != null && Number(pages) > 0 ? `${Number(pages)} стр.` : null;
  const timeStr =
    planSeconds != null && planSeconds > 0
      ? formatSecondsMmSs(planSeconds)
      : null;
  if (pageStr && timeStr) return `${pageStr} / ${timeStr}`;
  return pageStr ?? timeStr ?? "—";
}

export function computeDaySummary(scenes: DaySceneRow[]) {
  let totalPages = 0;
  let totalSeconds = 0;
  const locations = new Set<string>();
  let shotCount = 0;

  for (const row of scenes) {
    const pages = row.estimatedPages ?? row.scene.pageCount;
    if (pages != null) totalPages += Number(pages);
    if (row.scene.planSeconds != null) {
      totalSeconds += row.scene.planSeconds;
    }
    for (const link of row.scene.locations ?? []) {
      locations.add(link.location.name);
    }
    if (row.scene.status === "SHOT") shotCount += 1;
  }

  return {
    sceneCount: scenes.length,
    shotCount,
    totalPages,
    totalSeconds,
    locations: Array.from(locations).sort(),
  };
}

export function formatDaySummary(summary: ReturnType<typeof computeDaySummary>) {
  const parts: string[] = [];
  parts.push(`${summary.sceneCount} сц.`);
  if (summary.shotCount > 0) {
    parts.push(`${summary.shotCount} снято`);
  }
  if (summary.totalSeconds > 0) {
    parts.push(formatSecondsMmSs(summary.totalSeconds));
  }
  if (summary.totalPages > 0) {
    parts.push(`${summary.totalPages} стр.`);
  }
  return parts.join(" · ");
}

type SceneWithCharacters = SceneLike & {
  characters?: { character: { id: string; name: string } }[];
};

export type SceneGroupMode = "location" | "actor";

export function resolveSceneGroupKey(
  scene: SceneWithCharacters,
  mode: SceneGroupMode,
  characterToActor: Record<string, string> = {},
  actorNames: Record<string, string> = {},
): string {
  if (mode === "location") {
    return scene.locations?.[0]?.location.name ?? "Без объекта";
  }
  for (const link of scene.characters ?? []) {
    const actorId = characterToActor[link.character.id];
    if (actorId && actorNames[actorId]) {
      return actorNames[actorId];
    }
  }
  if (scene.characters?.[0]) {
    return scene.characters[0].character.name;
  }
  return "Без актёра";
}

export function groupScenesByLocation<T extends SceneLike>(scenes: T[]) {
  const groups = new Map<string, T[]>();
  for (const scene of scenes) {
    const key = scene.locations?.[0]?.location.name ?? "Без объекта";
    const list = groups.get(key) ?? [];
    list.push(scene);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "ru"));
}

export function groupScenesByActor<T extends SceneWithCharacters>(
  scenes: T[],
  characterToActor: Record<string, string>,
  actorNames: Record<string, string>,
) {
  const groups = new Map<string, T[]>();
  for (const scene of scenes) {
    const key = resolveSceneGroupKey(scene, "actor", characterToActor, actorNames);
    const list = groups.get(key) ?? [];
    list.push(scene);
    groups.set(key, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, "ru"));
}

export type DaySceneVisualBlock<T> =
  | { type: "header"; label: string }
  | { type: "row"; row: T };

/** Visual subsections along sort order; DnD order stays on `rows`. */
export function buildDaySceneVisualBlocks<T extends { scene: SceneWithCharacters }>(
  rows: T[],
  mode: SceneGroupMode | "none",
  characterToActor: Record<string, string> = {},
  actorNames: Record<string, string> = {},
): DaySceneVisualBlock<T>[] {
  if (mode === "none") {
    return rows.map((row) => ({ type: "row", row }));
  }

  const blocks: DaySceneVisualBlock<T>[] = [];
  let prevKey: string | null = null;
  for (const row of rows) {
    const key = resolveSceneGroupKey(
      row.scene,
      mode,
      characterToActor,
      actorNames,
    );
    if (key !== prevKey) {
      blocks.push({ type: "header", label: key });
      prevKey = key;
    }
    blocks.push({ type: "row", row });
  }
  return blocks;
}
