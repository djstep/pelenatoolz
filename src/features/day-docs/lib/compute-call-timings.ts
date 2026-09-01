import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { addMinutesToTime } from "@/features/day-docs/lib/time-utils";

export type ActorTimingField =
  | "pickupTime"
  | "makeupTime"
  | "costumeTime"
  | "readyTime"
  | "wrapTime";

export type ActorTimingProposal = {
  actorId: string;
  label: string;
  fields: Partial<
    Record<
      ActorTimingField,
      { current: string | null; proposed: string | null }
    >
  >;
};

type SceneSlot = {
  sceneId: string;
  startTime: string;
  endTime: string;
};

type ActorInput = {
  id: string;
  characterId: string | null;
  label: string;
  pickupOffsetMin: number | null;
};

type CharacterInput = {
  id: string;
  makeupOffsetMin: number | null;
  costumeOffsetMin: number | null;
};

type SceneCharacterLink = {
  sceneId: string;
  characterId: string;
};

type TimingComputeInput = {
  timeSlots: Array<{
    startTime: string;
    endTime: string | null;
    slotType: string;
    sceneId: string | null;
  }>;
  sceneCharacters: SceneCharacterLink[];
  actors: ActorInput[];
  characters: CharacterInput[];
};

function subtractMinutes(time: string, minutes: number): string {
  return addMinutesToTime(time, -minutes);
}

function buildSceneSlotMap(
  slots: TimingComputeInput["timeSlots"],
): Map<string, SceneSlot> {
  const map = new Map<string, SceneSlot>();
  for (const slot of slots) {
    if (slot.slotType !== "SHOOTING" || !slot.sceneId || !slot.endTime) continue;
    map.set(slot.sceneId, {
      sceneId: slot.sceneId,
      startTime: slot.startTime,
      endTime: slot.endTime,
    });
  }
  return map;
}

function sceneOrderFromSlots(
  slots: Array<{ slotType: string; sceneId: string | null }>,
): string[] {
  const order: string[] = [];
  for (const slot of slots) {
    if (slot.slotType === "SHOOTING" && slot.sceneId) {
      order.push(slot.sceneId);
    }
  }
  return order;
}

function buildProposedForActor(
  actor: ActorInput,
  character: CharacterInput | undefined,
  ready: string,
  wrap: string,
): Partial<Record<ActorTimingField, string | null>> {
  const proposed: Partial<Record<ActorTimingField, string | null>> = {
    readyTime: ready,
    wrapTime: wrap,
  };

  if (character?.makeupOffsetMin != null && character.makeupOffsetMin > 0) {
    proposed.makeupTime = subtractMinutes(ready, character.makeupOffsetMin);
  }

  if (character?.costumeOffsetMin != null && character.costumeOffsetMin > 0) {
    const anchor = proposed.makeupTime ?? ready;
    proposed.costumeTime = subtractMinutes(anchor, character.costumeOffsetMin);
  }

  if (actor.pickupOffsetMin != null && actor.pickupOffsetMin > 0) {
    proposed.pickupTime = subtractMinutes(ready, actor.pickupOffsetMin);
  }

  return proposed;
}

function computeActorTimingResults(input: TimingComputeInput) {
  const slotMap = buildSceneSlotMap(input.timeSlots);
  const sceneOrder = sceneOrderFromSlots(input.timeSlots);
  if (sceneOrder.length === 0) return [];

  const charactersByScene = new Map<string, Set<string>>();
  for (const link of input.sceneCharacters) {
    if (!charactersByScene.has(link.sceneId)) {
      charactersByScene.set(link.sceneId, new Set());
    }
    charactersByScene.get(link.sceneId)!.add(link.characterId);
  }

  const characterMap = new Map(input.characters.map((c) => [c.id, c] as const));
  const results: Array<{
    actor: ActorInput;
    proposed: Partial<Record<ActorTimingField, string | null>>;
  }> = [];

  for (const actor of input.actors) {
    if (!actor.characterId) continue;

    const sceneIds = sceneOrder.filter((sceneId) =>
      charactersByScene.get(sceneId)?.has(actor.characterId!),
    );
    if (sceneIds.length === 0) continue;

    const firstSlot = slotMap.get(sceneIds[0]!);
    const lastSlot = slotMap.get(sceneIds[sceneIds.length - 1]!);
    if (!firstSlot || !lastSlot) continue;

    results.push({
      actor,
      proposed: buildProposedForActor(
        actor,
        characterMap.get(actor.characterId),
        firstSlot.startTime,
        lastSlot.endTime,
      ),
    });
  }

  return results;
}

export type ActorTimingBaselines = Record<
  string,
  Partial<Record<ActorTimingField, string>>
>;

export function computeActorTimingBaselines(
  input: TimingComputeInput,
): ActorTimingBaselines {
  const out: ActorTimingBaselines = {};
  for (const { actor, proposed } of computeActorTimingResults(input)) {
    const fields: Partial<Record<ActorTimingField, string>> = {};
    for (const [key, value] of Object.entries(proposed) as [
      ActorTimingField,
      string | null | undefined,
    ][]) {
      if (value) fields[key] = value;
    }
    out[actor.id] = fields;
  }
  return out;
}

export function computeActorTimingProposals(
  input: TimingComputeInput & {
    currentCalls: Array<{
      actorId: string;
      pickupTime: string | null;
      makeupTime: string | null;
      costumeTime: string | null;
      readyTime: string | null;
      wrapTime: string | null;
    }>;
  },
): ActorTimingProposal[] {
  const currentByActor = new Map(
    input.currentCalls.map((c) => [c.actorId, c] as const),
  );

  const proposals: ActorTimingProposal[] = [];

  for (const { actor, proposed } of computeActorTimingResults(input)) {
    const current = currentByActor.get(actor.id);
    const fields: ActorTimingProposal["fields"] = {};

    for (const field of Object.keys(proposed) as ActorTimingField[]) {
      const next = proposed[field] ?? null;
      const prev = current?.[field] ?? null;
      if (next !== prev) {
        fields[field] = { current: prev, proposed: next };
      }
    }

    if (Object.keys(fields).length > 0) {
      proposals.push({ actorId: actor.id, label: actor.label, fields });
    }
  }

  return proposals;
}

export function isManualActorTiming(
  current: string | null | undefined,
  computed: string | null | undefined,
): boolean {
  return Boolean(current?.trim() && computed && current.trim() !== computed);
}

export function minutesToDurationHhMm(minutes: number): string {
  return formatMinutesHhMm(Math.max(1, Math.round(minutes)));
}

export type ResourceTimingField =
  | "arrivalTime"
  | "costumeTime"
  | "makeupTime"
  | "readyTime"
  | "wrapTime";

export type ResourceTimingProposal = {
  key: string;
  label: string;
  fields: Partial<
    Record<
      ResourceTimingField,
      { current: string | null; proposed: string | null }
    >
  >;
};

export type ResourceTimingBaselines = Record<
  string,
  Partial<Record<ResourceTimingField, string>>
>;

type ResourceSceneLink = {
  category: string;
  name: string;
  sceneId: string;
};

export function resourceTimingKey(category: string, name: string) {
  return `${category}::${name}`;
}

function collectResourceSceneLinks(
  dayScenes: Array<{
    scene: {
      id: string;
      resources: Array<{ category: string; name: string }>;
      elements: Array<{ element: { name: string; type: string } }>;
      resourceItems?: Array<{
        quantity: number;
        item: { name: string; category: { name: string; perShift: boolean } };
      }>;
    };
  }>,
): ResourceSceneLink[] {
  const links: ResourceSceneLink[] = [];
  for (const row of dayScenes) {
    const sceneId = row.scene.id;
    for (const res of row.scene.resources) {
      links.push({ category: res.category, name: res.name, sceneId });
    }
    for (const link of row.scene.elements) {
      const type = link.element.type;
      if (type === "PROP" || type === "OTHER") {
        links.push({ category: "ART", name: link.element.name, sceneId });
      } else if (type === "VEHICLE") {
        links.push({ category: "VEHICLE_EL", name: link.element.name, sceneId });
      }
    }
    for (const item of row.scene.resourceItems ?? []) {
      if (item.item.category.perShift) continue;
      const label =
        item.quantity > 1
          ? `${item.item.name} ×${item.quantity}`
          : item.item.name;
      links.push({
        category: item.item.category.name,
        name: label,
        sceneId,
      });
    }
  }
  return links;
}

function computeResourceTimingResults(input: {
  timeSlots: TimingComputeInput["timeSlots"];
  dayScenes: Parameters<typeof collectResourceSceneLinks>[0];
  shiftStartTime: string | null;
  callTime: string | null;
}): ResourceTimingBaselines {
  const slotMap = buildSceneSlotMap(input.timeSlots);
  const sceneOrder = sceneOrderFromSlots(input.timeSlots);
  const arrivalDefault = input.shiftStartTime ?? input.callTime ?? null;
  const links = collectResourceSceneLinks(input.dayScenes);

  const scenesByKey = new Map<string, Set<string>>();
  for (const link of links) {
    const key = resourceTimingKey(link.category, link.name);
    if (!scenesByKey.has(key)) scenesByKey.set(key, new Set());
    scenesByKey.get(key)!.add(link.sceneId);
  }

  const out: ResourceTimingBaselines = {};
  for (const [key, sceneIds] of scenesByKey) {
    const ordered = sceneOrder.filter((id) => sceneIds.has(id));
    if (ordered.length === 0) continue;
    const first = slotMap.get(ordered[0]!);
    const last = slotMap.get(ordered[ordered.length - 1]!);
    if (!first || !last) continue;
    const fields: Partial<Record<ResourceTimingField, string>> = {
      readyTime: first.startTime,
      wrapTime: last.endTime,
    };
    if (arrivalDefault) fields.arrivalTime = arrivalDefault;
    out[key] = fields;
  }
  return out;
}

export function computeResourceTimingBaselines(input: {
  timeSlots: TimingComputeInput["timeSlots"];
  dayScenes: Parameters<typeof collectResourceSceneLinks>[0];
  shiftStartTime: string | null;
  callTime: string | null;
}): ResourceTimingBaselines {
  return computeResourceTimingResults(input);
}

export function computeResourceTimingProposals(input: {
  timeSlots: TimingComputeInput["timeSlots"];
  dayScenes: Parameters<typeof collectResourceSceneLinks>[0];
  shiftStartTime: string | null;
  callTime: string | null;
  currentCalls: Array<{
    category: string;
    name: string;
    arrivalTime: string | null;
    costumeTime: string | null;
    makeupTime: string | null;
    readyTime: string | null;
    wrapTime: string | null;
  }>;
}): ResourceTimingProposal[] {
  const baselines = computeResourceTimingResults(input);
  const currentByKey = new Map(
    input.currentCalls.map((c) => [
      resourceTimingKey(c.category, c.name),
      c,
    ] as const),
  );

  const proposals: ResourceTimingProposal[] = [];
  for (const [key, proposed] of Object.entries(baselines)) {
    const current = currentByKey.get(key);
    const fields: ResourceTimingProposal["fields"] = {};
    for (const field of Object.keys(proposed) as ResourceTimingField[]) {
      const next = proposed[field] ?? null;
      const prev = current?.[field] ?? null;
      if (next !== prev) {
        fields[field] = { current: prev, proposed: next };
      }
    }
    if (Object.keys(fields).length === 0) continue;
    const label = key.includes("::") ? key.split("::").slice(1).join("::") : key;
    proposals.push({ key, label, fields });
  }
  return proposals.sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

export function isManualResourceTiming(
  current: string | null | undefined,
  computed: string | null | undefined,
): boolean {
  return isManualActorTiming(current, computed);
}
