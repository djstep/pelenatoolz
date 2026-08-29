import type { LocationKind, SceneStatus } from "@prisma/client";
import type { LocationWithStats } from "@/features/locations/queries";

export type LocationFilters = {
  addresses: string[];
  kinds: LocationKind[];
  hasDecoration: boolean | null;
  episodeFrom: string;
  episodeTo: string;
  sceneStatuses: SceneStatus[];
  sceneCountFrom: string;
  sceneCountTo: string;
  estimatedShiftFrom: string;
  estimatedShiftTo: string;
  kppShiftFrom: string;
  kppShiftTo: string;
  kppDateFrom: string;
  kppDateTo: string;
};

export const emptyLocationFilters = (): LocationFilters => ({
  addresses: [],
  kinds: [],
  hasDecoration: null,
  episodeFrom: "",
  episodeTo: "",
  sceneStatuses: [],
  sceneCountFrom: "",
  sceneCountTo: "",
  estimatedShiftFrom: "",
  estimatedShiftTo: "",
  kppShiftFrom: "",
  kppShiftTo: "",
  kppDateFrom: "",
  kppDateTo: "",
});

function parseNum(s: string) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function getKppShiftCount(loc: LocationWithStats) {
  const days = new Set<string>();
  for (const link of loc.scenes) {
    for (const d of link.scene.shootDayScenes) {
      days.add(d.shootDay.id);
    }
  }
  return days.size;
}

export function getEstimatedShiftCount(loc: LocationWithStats) {
  const days = new Set<string>();
  for (const link of loc.scenes) {
    const sd = link.scene.scriptDay;
    if (sd != null) days.add(`${link.scene.episodeNumber}:${sd}`);
  }
  return days.size || loc._count.scenes;
}

export function getLinkedSceneStatuses(loc: LocationWithStats) {
  return loc.scenes.map((s) => s.scene.status);
}

export function getKppDates(loc: LocationWithStats) {
  const dates: Date[] = [];
  for (const link of loc.scenes) {
    for (const d of link.scene.shootDayScenes) {
      dates.push(d.shootDay.date);
    }
  }
  return dates;
}

function inRange(value: number, from: string, to: string) {
  const f = parseNum(from);
  const t = parseNum(to);
  if (f != null && value < f) return false;
  if (t != null && value > t) return false;
  return true;
}

function inDateRange(date: Date, from: string, to: string) {
  const d = date.getTime();
  if (from) {
    const f = new Date(from).setHours(0, 0, 0, 0);
    if (d < f) return false;
  }
  if (to) {
    const t = new Date(to).setHours(23, 59, 59, 999);
    if (d > t) return false;
  }
  return true;
}

export function applyLocationFilters(
  locations: LocationWithStats[],
  filters: LocationFilters,
): LocationWithStats[] {
  return locations.filter((loc) => {
    if (filters.addresses.length > 0) {
      if (!loc.address || !filters.addresses.includes(loc.address)) return false;
    }

    if (filters.kinds.length > 0) {
      if (!loc.locationKind || !filters.kinds.includes(loc.locationKind)) {
        return false;
      }
    }

    if (filters.hasDecoration != null && loc.hasDecoration !== filters.hasDecoration) {
      return false;
    }

    if (filters.episodeFrom || filters.episodeTo) {
      const epFrom = parseNum(filters.episodeFrom);
      const epTo = parseNum(filters.episodeTo);
      const episodes = loc.scenes.map((s) => s.scene.episodeNumber);
      if (episodes.length === 0) return false;
      if (epFrom != null && !episodes.some((e) => e >= epFrom)) return false;
      if (epTo != null && !episodes.some((e) => e <= epTo)) return false;
    }

    if (filters.sceneStatuses.length > 0) {
      const statuses = getLinkedSceneStatuses(loc);
      if (!statuses.some((st) => filters.sceneStatuses.includes(st))) return false;
    }

    if (!inRange(loc._count.scenes, filters.sceneCountFrom, filters.sceneCountTo)) {
      return false;
    }

    if (
      !inRange(
        getEstimatedShiftCount(loc),
        filters.estimatedShiftFrom,
        filters.estimatedShiftTo,
      )
    ) {
      return false;
    }

    if (!inRange(getKppShiftCount(loc), filters.kppShiftFrom, filters.kppShiftTo)) {
      return false;
    }

    if (filters.kppDateFrom || filters.kppDateTo) {
      const dates = getKppDates(loc);
      if (dates.length === 0) return false;
      if (!dates.some((d) => inDateRange(d, filters.kppDateFrom, filters.kppDateTo))) {
        return false;
      }
    }

    return true;
  });
}
