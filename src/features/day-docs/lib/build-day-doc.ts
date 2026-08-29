import type { ElementType, SceneResourceCategory } from "@prisma/client";
import type { getShootDayDocument } from "@/features/day-docs/queries";
import {
  dayNightLabels,
  formatSecondsMmSs,
  intExtLabels,
  sceneStatusLabels,
} from "@/shared/i18n/domain-labels";

export type DayDocBundle = NonNullable<
  Awaited<ReturnType<typeof getShootDayDocument>>
>;

export type SceneRow = DayDocBundle["day"]["scenes"][number]["scene"];

export type CastRow = {
  characterName: string;
  actorName: string | null;
  actorId: string | null;
  phone: string | null;
  email: string | null;
  roleType: string | null;
  sceneNumbers: string[];
  pickup: string | null;
  arrival: string | null;
  makeup: string | null;
  costume: string | null;
  ready: string | null;
  wrap: string | null;
};

export type ResourceTableRow = {
  key: string;
  category: string;
  name: string;
  sceneNumbers: string[];
  arrival: string | null;
  costume: string | null;
  makeup: string | null;
  ready: string | null;
  wrap: string | null;
};

export type ShootingSlotDetails = {
  sceneNumber: string;
  planLabel: string;
  scriptDay: number | null;
  location: string | null;
  locationAddress: string | null;
  summary: string | null;
  characters: string[];
  extras: string[];
  groups: string[];
  stunts: string[];
  makeup: string[];
  costumes: string[];
  props: string[];
  vehicles: string[];
  camera: string[];
  custom: string[];
  notes: string | null;
};

function formatSceneNumber(scene: {
  episodeNumber: number;
  number: string;
  postfix: string;
}) {
  const ep = scene.episodeNumber > 0 ? `${scene.episodeNumber}-` : "";
  return `${ep}${scene.number}${scene.postfix || ""}`;
}

function resourceCallKey(category: string, name: string) {
  return `${category}::${name}`;
}

function lookupResourceCall(
  bundle: DayDocBundle,
  category: string,
  name: string,
) {
  const key = resourceCallKey(category, name);
  return bundle.day.resourceCalls.find(
    (r) => resourceCallKey(r.category, r.name) === key,
  );
}

export function buildDayStats(day: DayDocBundle["day"]) {
  let totalSeconds = 0;
  let totalPages = 0;
  let shot = 0;
  const locations = new Set<string>();

  for (const row of day.scenes) {
    if (row.scene.planSeconds) totalSeconds += row.scene.planSeconds;
    const pages = row.estimatedPages ?? row.scene.pageCount;
    if (pages != null) totalPages += Number(pages);
    if (row.scene.status === "SHOT") shot += 1;
    for (const link of row.scene.locations) {
      locations.add(link.location.name);
    }
  }

  return {
    sceneCount: day.scenes.length,
    shotCount: shot,
    notShotCount: day.scenes.length - shot,
    totalSeconds,
    totalPages,
    timingLabel:
      totalSeconds > 0 ? formatSecondsMmSs(totalSeconds) : "—",
    pagesLabel: totalPages > 0 ? `${totalPages.toFixed(2)} стр.` : "—",
    locations: Array.from(locations).sort((a, b) => a.localeCompare(b, "ru")),
  };
}

export function buildCastForDay(bundle: DayDocBundle): CastRow[] {
  const byCharacter = new Map<
    string,
    {
      characterName: string;
      characterId: string | null;
      sceneNumbers: Set<string>;
    }
  >();

  for (const row of bundle.day.scenes) {
    const num = formatSceneNumber(row.scene);
    for (const link of row.scene.characters) {
      const key = link.character.id;
      const existing = byCharacter.get(key);
      if (existing) {
        existing.sceneNumbers.add(num);
      } else {
        byCharacter.set(key, {
          characterName: link.character.name,
          characterId: link.character.id,
          sceneNumbers: new Set([num]),
        });
      }
    }
  }

  const actorsByCharacter = new Map(
    bundle.actors
      .filter((a) => a.characterId)
      .map((a) => [a.characterId!, a] as const),
  );

  const actorCallByActorId = new Map(
    bundle.day.actorCalls.map((c) => [c.actorId, c] as const),
  );

  const rows: CastRow[] = [];
  for (const entry of byCharacter.values()) {
    const actor = entry.characterId
      ? actorsByCharacter.get(entry.characterId)
      : undefined;
    const call = actor ? actorCallByActorId.get(actor.id) : undefined;
    const actorName = actor
      ? [actor.lastName, actor.firstName, actor.middleName]
          .filter(Boolean)
          .join(" ")
      : null;
    rows.push({
      characterName: entry.characterName,
      actorName,
      actorId: actor?.id ?? null,
      phone: actor?.phone1 ?? actor?.phone2 ?? null,
      email: actor?.email ?? null,
      roleType: actor?.roleType ?? null,
      sceneNumbers: Array.from(entry.sceneNumbers),
      pickup: call?.pickupTime ?? actor?.carPickupTime ?? null,
      arrival: call?.arrivalTime ?? actor?.arrivalTime ?? null,
      makeup: call?.makeupTime ?? null,
      costume: call?.costumeTime ?? null,
      ready: call?.readyTime ?? null,
      wrap: call?.wrapTime ?? null,
    });
  }

  return rows.sort((a, b) =>
    a.characterName.localeCompare(b.characterName, "ru"),
  );
}

type ResourceAccumulator = {
  category: string;
  name: string;
  sceneNumbers: Set<string>;
};

function addResource(
  map: Map<string, ResourceAccumulator>,
  category: string,
  name: string,
  sceneNumber: string,
) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const key = resourceCallKey(category, trimmed);
  const existing = map.get(key);
  if (existing) {
    existing.sceneNumbers.add(sceneNumber);
  } else {
    map.set(key, {
      category,
      name: trimmed,
      sceneNumbers: new Set([sceneNumber]),
    });
  }
}

function mapResourcesToRows(
  bundle: DayDocBundle,
  map: Map<string, ResourceAccumulator>,
): ResourceTableRow[] {
  return Array.from(map.values())
    .map((entry) => {
      const call = lookupResourceCall(bundle, entry.category, entry.name);
      return {
        key: resourceCallKey(entry.category, entry.name),
        category: entry.category,
        name: entry.name,
        sceneNumbers: Array.from(entry.sceneNumbers).sort((a, b) =>
          a.localeCompare(b, "ru", { numeric: true }),
        ),
        arrival: call?.arrivalTime ?? null,
        costume: call?.costumeTime ?? null,
        makeup: call?.makeupTime ?? null,
        ready: call?.readyTime ?? null,
        wrap: call?.wrapTime ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function buildResourceTables(bundle: DayDocBundle) {
  const extras = new Map<string, ResourceAccumulator>();
  const stunts = new Map<string, ResourceAccumulator>();
  const props = new Map<string, ResourceAccumulator>();
  const art = new Map<string, ResourceAccumulator>();
  const camera = new Map<string, ResourceAccumulator>();
  const vehicles = new Map<string, ResourceAccumulator>();

  for (const row of bundle.day.scenes) {
    const num = formatSceneNumber(row.scene);
    for (const res of row.scene.resources) {
      const cat = res.category as SceneResourceCategory;
      if (cat === "EXTRAS" || cat === "GROUP") {
        addResource(extras, cat, res.name, num);
      } else if (cat === "STUNT") {
        addResource(stunts, cat, res.name, num);
      } else if (cat === "PROP") {
        addResource(props, cat, res.name, num);
      } else if (cat === "CAMERA" || cat === "CUSTOM") {
        addResource(camera, cat, res.name, num);
      } else if (cat === "VEHICLE") {
        addResource(vehicles, cat, res.name, num);
      }
    }
    for (const link of row.scene.elements) {
      const el = link.element;
      const type = el.type as ElementType;
      if (type === "PROP" || type === "OTHER") {
        addResource(art, "ART", el.name, num);
      } else if (type === "VEHICLE") {
        addResource(vehicles, "VEHICLE_EL", el.name, num);
      }
    }
  }

  return {
    extras: mapResourcesToRows(bundle, extras),
    stunts: mapResourcesToRows(bundle, stunts),
    art: mapResourcesToRows(bundle, art),
    camera: mapResourcesToRows(bundle, camera),
    props: mapResourcesToRows(bundle, props),
    vehicles: mapResourcesToRows(bundle, vehicles),
  };
}

export function buildShootingSlotDetails(
  scene: SceneRow,
  assignmentNotes?: string | null,
): ShootingSlotDetails {
  const extras: string[] = [];
  const groups: string[] = [];
  const stunts: string[] = [];
  const makeup: string[] = [];
  const costumes: string[] = [];
  const props: string[] = [];
  const vehicles: string[] = [];
  const camera: string[] = [];
  const custom: string[] = [];

  for (const res of scene.resources) {
    const label =
      res.quantity > 1 ? `${res.name} ×${res.quantity}` : res.name;
    switch (res.category) {
      case "EXTRAS":
        extras.push(label);
        break;
      case "GROUP":
        groups.push(label);
        break;
      case "STUNT":
        stunts.push(label);
        break;
      case "MAKEUP":
        makeup.push(label);
        break;
      case "COSTUME":
        costumes.push(label);
        break;
      case "PROP":
        props.push(label);
        break;
      case "VEHICLE":
        vehicles.push(label);
        break;
      case "CAMERA":
        camera.push(label);
        break;
      case "CUSTOM":
        custom.push(label);
        break;
    }
  }

  for (const link of scene.elements) {
    const el = link.element;
    const label = el.name;
    switch (el.type) {
      case "MAKEUP":
        makeup.push(label);
        break;
      case "COSTUME":
      case "WARDROBE":
        costumes.push(label);
        break;
      case "PROP":
      case "OTHER":
        props.push(label);
        break;
      case "VEHICLE":
        vehicles.push(label);
        break;
      default:
        custom.push(label);
    }
  }

  const loc = scene.locations[0]?.location;
  const pages = scene.pageCount != null ? Number(scene.pageCount) : null;
  const planParts: string[] = [];
  if (pages != null && pages > 0) planParts.push(`${pages.toFixed(2)} стр.`);
  if (scene.planSeconds) planParts.push(formatSecondsMmSs(scene.planSeconds));

  return {
    sceneNumber: formatSceneNumber(scene),
    planLabel: planParts.join(" · ") || "—",
    scriptDay: scene.scriptDay,
    location: loc?.name ?? null,
    locationAddress: loc?.address ?? null,
    summary: scene.summary ?? scene.title ?? null,
    characters: scene.characters.map((c) => c.character.name),
    extras,
    groups,
    stunts,
    makeup,
    costumes,
    props,
    vehicles,
    camera,
    custom,
    notes: assignmentNotes ?? null,
  };
}

export function inferDayNightLabel(day: DayDocBundle["day"]) {
  if (day.isNightShift) return "Ночь";
  const counts = { DAY: 0, NIGHT: 0, DAWN: 0, DUSK: 0 };
  for (const row of day.scenes) {
    if (row.scene.dayNight) counts[row.scene.dayNight] += 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) {
    return dayNightLabels[top[0] as keyof typeof dayNightLabels];
  }
  return day.isNightShift ? "Ночь" : "День";
}

export function formatSceneLine(scene: SceneRow) {
  const num = formatSceneNumber(scene);
  const loc = scene.locations[0]?.location.name;
  const parts = [num];
  if (loc) parts.push(loc);
  if (scene.intExt) parts.push(intExtLabels[scene.intExt]);
  if (scene.dayNight) parts.push(dayNightLabels[scene.dayNight]);
  return parts.join(" · ");
}

export function sceneStatusLabel(status: string) {
  return (
    sceneStatusLabels[status as keyof typeof sceneStatusLabels] ?? status
  );
}

export function slotDurationLabel(start: string, end: string | null) {
  if (!end) return "—";
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const diff = toMin(end) - toMin(start);
  if (diff <= 0) return "—";
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h > 0 && m > 0) return `${h}ч ${m}м`;
  if (h > 0) return `${h}ч`;
  return `${m}м`;
}

export { formatSceneNumber };
