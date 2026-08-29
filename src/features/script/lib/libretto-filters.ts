import type { SceneKind, SceneStatus } from "@prisma/client";
import type { LibrettoScene } from "@/features/script/lib/libretto-display";

export type TextMatchMode = "one_of" | "exclude" | "all" | "exact";

export type LibrettoFilters = {
  search: string;
  shootDateFrom: string;
  shootDateTo: string;
  episodeFrom: string;
  episodeTo: string;
  sceneFrom: string;
  sceneTo: string;
  dayNight: string;
  scriptDay: string;
  statuses: SceneStatus[];
  sceneKinds: SceneKind[];
  shootingUnits: string[];
  locationKinds: string[];
  locationQuery: string;
  locationMode: TextMatchMode;
  placeQuery: string;
  placeMode: TextMatchMode;
  characterQuery: string;
  characterMode: TextMatchMode;
  actorQuery: string;
  actorMode: TextMatchMode;
  resourceQuery: string;
};

export const emptyFilters = (): LibrettoFilters => ({
  search: "",
  shootDateFrom: "",
  shootDateTo: "",
  episodeFrom: "",
  episodeTo: "",
  sceneFrom: "",
  sceneTo: "",
  dayNight: "",
  scriptDay: "",
  statuses: [],
  sceneKinds: [],
  shootingUnits: [],
  locationKinds: [],
  locationQuery: "",
  locationMode: "one_of",
  placeQuery: "",
  placeMode: "one_of",
  characterQuery: "",
  characterMode: "one_of",
  actorQuery: "",
  actorMode: "one_of",
  resourceQuery: "",
});

function parseNum(s: string) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function matchText(
  haystack: string[],
  query: string,
  mode: TextMatchMode,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/[,;]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;
  const lower = haystack.map((h) => h.toLowerCase());

  if (mode === "exact") {
    return tokens.every((t) => lower.some((h) => h === t));
  }
  if (mode === "all") {
    return tokens.every((t) =>
      lower.some((h) => h.includes(t) || t.includes(h)),
    );
  }
  if (mode === "exclude") {
    return !tokens.some((t) => lower.some((h) => h.includes(t)));
  }
  return tokens.some((t) => lower.some((h) => h.includes(t)));
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

export function applyLibrettoFilters(
  scenes: LibrettoScene[],
  filters: LibrettoFilters,
  formatNumber: (s: LibrettoScene) => string,
): LibrettoScene[] {
  return scenes.filter((scene) => {
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      const blob = [
        formatNumber(scene),
        scene.locations[0]?.location.name,
        scene.locations[0]?.location.sublocation,
        scene.summary,
        ...scene.characters.map((c) => c.character.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }

    if (filters.shootDateFrom || filters.shootDateTo) {
      const dates = scene.shootDayScenes.map((s) => s.shootDay.date);
      if (dates.length === 0) return false;
      if (!dates.some((d) => inDateRange(d, filters.shootDateFrom, filters.shootDateTo))) {
        return false;
      }
    }

    const epFrom = parseNum(filters.episodeFrom);
    const epTo = parseNum(filters.episodeTo);
    if (epFrom != null && scene.episodeNumber < epFrom) return false;
    if (epTo != null && scene.episodeNumber > epTo) return false;

    const scFrom = parseNum(filters.sceneFrom);
    const scTo = parseNum(filters.sceneTo);
    const scNum = parseNum(scene.number);
    if (scFrom != null && scNum != null && scNum < scFrom) return false;
    if (scTo != null && scNum != null && scNum > scTo) return false;

    if (filters.dayNight && scene.dayNight !== filters.dayNight) return false;
    if (filters.scriptDay) {
      const sd = parseNum(filters.scriptDay);
      if (sd != null && scene.scriptDay !== sd) return false;
    }

    if (
      filters.statuses.length > 0 &&
      !filters.statuses.includes(scene.status)
    ) {
      return false;
    }

    if (
      filters.sceneKinds.length > 0 &&
      !filters.sceneKinds.includes(scene.sceneKind)
    ) {
      return false;
    }

    if (filters.shootingUnits.length > 0) {
      const units = [
        scene.shootingUnit,
        ...scene.shootDayScenes.map((s) => s.shootDay.unit),
      ].filter(Boolean);
      if (!filters.shootingUnits.some((u) => units.includes(u))) return false;
    }

    if (filters.locationKinds.length > 0) {
      const kind = scene.locations[0]?.location.locationKind;
      if (!kind || !filters.locationKinds.includes(kind)) return false;
    }

    const locNames = scene.locations.map((l) =>
      l.location.sublocation
        ? `${l.location.name}.${l.location.sublocation}`
        : l.location.name,
    );
    if (
      !matchText(locNames, filters.locationQuery, filters.locationMode)
    ) {
      return false;
    }

    const places = scene.locations
      .map((l) => l.location.address ?? "")
      .filter(Boolean);
    if (!matchText(places, filters.placeQuery, filters.placeMode)) {
      return false;
    }

    const chars = scene.characters.map((c) => c.character.name);
    if (!matchText(chars, filters.characterQuery, filters.characterMode)) {
      return false;
    }

    const actors = scene.characters.flatMap((c) =>
      c.character.actors.map((a) =>
        [a.lastName, a.firstName].filter(Boolean).join(" "),
      ),
    );
    if (!matchText(actors, filters.actorQuery, filters.actorMode)) {
      return false;
    }

    if (filters.resourceQuery.trim()) {
      const resources = [
        ...scene.resources.map((r) => r.name),
        ...scene.elements.map((e) => e.element.name),
      ];
      if (!matchText(resources, filters.resourceQuery, "one_of")) {
        return false;
      }
    }

    return true;
  });
}
