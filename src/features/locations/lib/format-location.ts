import type { LocationKind } from "@prisma/client";
import { locationKindLabels } from "@/shared/i18n/domain-labels";

/**
 * Строка объекта из базы. Объект: `parent` пусто. Подобъект: `parent` — объект, `name` — подобъект.
 * Старые записи хранят подобъект в `sublocation` рядом с названием объекта (до разбивки данных).
 * `parent` обязателен в типе: выборка без `parent: LOCATION_PARENT_SELECT` не пройдёт проверку типов.
 */
export type LocationObjectSource = { name: string; parent: { name: string } | null };
export type LocationNameSource = LocationObjectSource & { sublocation: string | null };

/** Объект строки: «ДОМ» и для «ДОМ», и для подобъекта «КУХНЯ» объекта ДОМ. */
export function locationObjectName(location: LocationObjectSource): string {
  return location.parent?.name ?? location.name;
}

/** Подобъект строки: «КУХНЯ»; у объекта без подобъекта — null. */
export function locationSubName(location: LocationNameSource): string | null {
  if (location.parent) return location.name;
  return location.sublocation?.trim() || null;
}

/** «ДОМ.КУХНЯ» или «ДОМ». Разделитель — как было на экране: «.», «. » или « / ». */
export function formatLocationTitle(location: LocationNameSource, separator = "."): string {
  const object = locationObjectName(location);
  const sub = locationSubName(location);
  return sub ? `${object}${separator}${sub}` : object;
}

/**
 * Строка как пара «объект + подобъект» (`name` — объект, `sublocation` — подобъект):
 * так её видят разбор шапок и вопросы импорта, для старых и новых записей одинаково.
 */
export function locationAsPair<T extends LocationNameSource & { id: string }>(location: T) {
  return {
    id: location.id,
    name: locationObjectName(location),
    sublocation: locationSubName(location),
  };
}

type SortableLocation = LocationNameSource & {
  id?: string;
  parent: { name: string; id?: string } | null;
  sortOrder?: number | null;
};

/** Группа строки — id объекта: у двух одноимённых объектов подобъекты не перемешиваются. */
function groupId(location: SortableLocation) {
  return (location.parent ? location.parent.id : location.id) ?? "";
}

/**
 * Порядок в списках: по объекту (алфавит), внутри — объект первым, затем подобъекты
 * по `sortOrder` и названию. Вместо `orderBy: [{ name }, { sublocation }]`: у подобъекта
 * `name` — его собственное название, и сортировка базы разнесла бы подобъекты по алфавиту.
 */
export function compareLocations(a: SortableLocation, b: SortableLocation): number {
  const byObject = locationObjectName(a).localeCompare(locationObjectName(b), "ru");
  if (byObject !== 0) return byObject;
  const byGroup = groupId(a).localeCompare(groupId(b));
  if (byGroup !== 0) return byGroup;
  const subA = locationSubName(a);
  const subB = locationSubName(b);
  if (!subA || !subB) return Number(Boolean(subA)) - Number(Boolean(subB));
  const byOrder = (a.parent ? (a.sortOrder ?? 0) : 0) - (b.parent ? (b.sortOrder ?? 0) : 0);
  return byOrder !== 0 ? byOrder : subA.localeCompare(subB, "ru");
}

export function formatLocationKind(kind: LocationKind | null | undefined) {
  return kind ? locationKindLabels[kind] : "—";
}

export function parseTags(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}
