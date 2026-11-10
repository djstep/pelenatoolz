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
