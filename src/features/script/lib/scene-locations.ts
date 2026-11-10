/** Привязка сцены и объект, к которому она относится (объект — сам себе объект). */
export type SceneLink = { locationId: string; objectId: string };

/** Привязка из выборки сцены: `location.parent` — объект подобъекта. */
export function sceneLinkOf(link: {
  locationId: string;
  location: { id: string; parent: { id: string } | null };
}): SceneLink {
  return { locationId: link.locationId, objectId: link.location.parent?.id ?? link.location.id };
}

/**
 * Что показывает карточка сцены: объект первой привязки, его выбранные подобъекты и другие
 * объекты сцены (сцена с двумя объектами, «ДВОР ДОМА / ОПУШКА ЛЕСА»), которые карточка не правит.
 */
export function cardPlaces(links: readonly SceneLink[]) {
  const objectId = links[0]?.objectId ?? "";
  const subIds = links
    .filter((l) => l.objectId === objectId && l.locationId !== objectId)
    .map((l) => l.locationId);
  const otherObjectIds = [...new Set(links.map((l) => l.objectId).filter((id) => id !== objectId))];
  return { objectId, subIds, otherObjectIds };
}

/**
 * Привязки сцены после сохранения карточки. Выбор карточки — подобъекты объекта, а без них
 * объект целиком — заменяет привязки показанного объекта (`prevObjectId`) и выбранного.
 * Привязки к другим объектам сцены остаются как были. Выбор — первым: его карточка и покажет.
 */
export function sceneLocationIdsAfterCard(input: {
  current: readonly SceneLink[];
  prevObjectId: string | null;
  objectId: string;
  subIds: readonly string[];
}): string[] {
  const prev = input.prevObjectId ?? input.current[0]?.objectId ?? null;
  const chosen = input.subIds.length > 0 ? input.subIds : [input.objectId];
  const kept = input.current
    .filter((l) => l.objectId !== prev && l.objectId !== input.objectId)
    .map((l) => l.locationId);
  return [...new Set([...chosen, ...kept])];
}
