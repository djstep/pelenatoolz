import type { SceneStatus } from "@prisma/client";
import type { ProjectType } from "@prisma/client";
import { sceneKindLabels, sceneStatusLabels } from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import type { listScenes } from "@/features/script/queries";

export type LibrettoScene = Awaited<ReturnType<typeof listScenes>>[number];

export function formatSceneNumber(
  scene: Pick<LibrettoScene, "episodeNumber" | "number" | "postfix">,
  projectType: ProjectType,
) {
  const num = `${scene.number}${scene.postfix || ""}`;
  if (projectType === "SERIES" && scene.episodeNumber > 0) {
    return `${scene.episodeNumber}-${num}`;
  }
  return num;
}

export function formatLocationCell(scene: LibrettoScene) {
  const loc = scene.locations[0]?.location;
  if (!loc) return "—";
  return loc.sublocation?.trim()
    ? `${loc.name}.${loc.sublocation}`
    : loc.name;
}

export function formatPlaceCell(scene: LibrettoScene) {
  return scene.locations[0]?.location.address ?? "—";
}

export function getActorNames(scene: LibrettoScene) {
  const names = new Set<string>();
  for (const link of scene.characters) {
    for (const actor of link.character.actors) {
      names.add(
        [actor.lastName, actor.firstName].filter(Boolean).join(" "),
      );
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, "ru"));
}

function resourceNames(scene: LibrettoScene, categories: string[]) {
  return scene.resources
    .filter((r) => categories.includes(r.category))
    .map((r) => r.name)
    .join(", ");
}

/** «Люди на причале (6)» — имя и количество, если quantity > 1. */
function resourceNamesWithQty(scene: LibrettoScene, categories: string[]) {
  return scene.resources
    .filter((r) => categories.includes(r.category))
    .map((r) => (r.quantity > 1 ? `${r.name} (${r.quantity})` : r.name))
    .join(", ");
}

function elementNames(scene: LibrettoScene, types: string[]) {
  return scene.elements
    .filter((e) => types.includes(e.element.type))
    .map((e) => e.element.name)
    .join(", ");
}

export function getExtras(scene: LibrettoScene) {
  return resourceNamesWithQty(scene, ["EXTRAS"]) || "—";
}

export function getGroup(scene: LibrettoScene) {
  return resourceNamesWithQty(scene, ["GROUP"]) || "—";
}

export function getStunt(scene: LibrettoScene) {
  return resourceNames(scene, ["STUNT"]) || "—";
}

export function getMakeup(scene: LibrettoScene) {
  const fromRes = resourceNames(scene, ["MAKEUP"]);
  const fromEl = elementNames(scene, ["MAKEUP"]);
  return [fromRes, fromEl].filter(Boolean).join(", ") || "—";
}

export function getStatusDateLabel(scene: LibrettoScene): string {
  const statusLabel = sceneStatusLabels[scene.status];
  let date: Date | null = scene.statusDate;

  if (scene.status === "PLANNING" && scene.shootDayScenes.length > 0) {
    const latest = scene.shootDayScenes
      .map((s) => s.shootDay.date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    date = latest ?? date;
  }

  if (!date) return statusLabel;
  return `${statusLabel} (${formatDateShort(date)})`;
}

export function getResourceCategoryCell(
  scene: LibrettoScene,
  categoryId: string,
): string {
  const links = (scene.resourceItems ?? []).filter(
    (l) => l.item.category.id === categoryId,
  );
  if (links.length === 0) return "—";
  return links
    .map((l) =>
      l.quantity > 1 ? `${l.item.name} ×${l.quantity}` : l.item.name,
    )
    .join(", ");
}

export function getPlannedShootDates(scene: LibrettoScene): Date[] {
  return scene.shootDayScenes.map((s) => s.shootDay.date);
}

export function getShootUnitsFromScene(scene: LibrettoScene): string[] {
  const units = new Set<string>();
  if (scene.shootingUnit) units.add(scene.shootingUnit);
  for (const s of scene.shootDayScenes) {
    if (s.shootDay.unit) units.add(s.shootDay.unit);
  }
  return Array.from(units);
}
