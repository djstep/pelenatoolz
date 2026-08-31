import type { SceneStatus } from "@prisma/client";
import type { CharacterWithStats } from "@/features/characters/queries";

export type CastFilterStatus = "APPROVED" | "OPEN" | "HAS_CANDIDATES";

export type CharacterFilters = {
  castStatuses: CastFilterStatus[];
  episodeFrom: string;
  episodeTo: string;
  sceneStatuses: SceneStatus[];
  sceneCountFrom: string;
  sceneCountTo: string;
  planMinutesFrom: string;
  planMinutesTo: string;
  hasRoleRequirements: boolean | null;
  hasDescription: boolean | null;
};

export const emptyCharacterFilters = (): CharacterFilters => ({
  castStatuses: [],
  episodeFrom: "",
  episodeTo: "",
  sceneStatuses: [],
  sceneCountFrom: "",
  sceneCountTo: "",
  planMinutesFrom: "",
  planMinutesTo: "",
  hasRoleRequirements: null,
  hasDescription: null,
});

function parseNum(s: string) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function inRange(value: number, from: string, to: string) {
  const f = parseNum(from);
  const t = parseNum(to);
  if (f != null && value < f) return false;
  if (t != null && value > t) return false;
  return true;
}

export function getCharacterCastStatus(
  row: CharacterWithStats,
): CastFilterStatus {
  if (row.isApproved) return "APPROVED";
  if (row.candidateCount > 0) return "HAS_CANDIDATES";
  return "OPEN";
}

export function getLinkedSceneStatuses(row: CharacterWithStats) {
  return row.scenes.map((s) => s.scene.status);
}

export function applyCharacterFilters(
  rows: CharacterWithStats[],
  filters: CharacterFilters,
): CharacterWithStats[] {
  return rows.filter((row) => {
    if (filters.castStatuses.length > 0) {
      const status = getCharacterCastStatus(row);
      if (!filters.castStatuses.includes(status)) return false;
    }

    if (filters.hasRoleRequirements != null) {
      const has = Boolean(row.roleRequirements?.trim());
      if (has !== filters.hasRoleRequirements) return false;
    }

    if (filters.hasDescription != null) {
      const has = Boolean(row.description?.trim());
      if (has !== filters.hasDescription) return false;
    }

    if (filters.episodeFrom || filters.episodeTo) {
      const epFrom = parseNum(filters.episodeFrom);
      const epTo = parseNum(filters.episodeTo);
      const episodes = row.scenes.map((s) => s.scene.episodeNumber);
      if (episodes.length === 0) return false;
      if (epFrom != null && !episodes.some((e) => e >= epFrom)) return false;
      if (epTo != null && !episodes.some((e) => e <= epTo)) return false;
    }

    if (filters.sceneStatuses.length > 0) {
      const statuses = getLinkedSceneStatuses(row);
      if (!statuses.some((st) => filters.sceneStatuses.includes(st))) return false;
    }

    if (!inRange(row.sceneCount, filters.sceneCountFrom, filters.sceneCountTo)) {
      return false;
    }

    const planMinutes = row.planSeconds / 60;
    if (!inRange(planMinutes, filters.planMinutesFrom, filters.planMinutesTo)) {
      return false;
    }

    return true;
  });
}
