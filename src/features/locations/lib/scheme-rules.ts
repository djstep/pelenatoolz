import { z } from "zod";
import { parseCoordinates } from "@/features/locations/lib/coordinates";

/** Схема объекта для вызывного: координаты, тексты «Как добраться», «Парковка», «На месте», точки. */

export const MAX_SCHEME_TEXT = 2000;
export const MAX_SCHEME_POINTS = 100;
export const MAX_POINT_NUMBER = 20;
export const MAX_POINT_NAME = 200;
export const MAX_POINT_DESCRIPTION = 1000;

export const NO_RIGHTS = "Недостаточно прав";
export const LOCATION_NOT_FOUND = "Объект не найден";

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => (v === "" ? null : v));

const pointSchema = z.object({
  number: z
    .string()
    .trim()
    .min(1, "Укажите номер точки")
    .max(MAX_POINT_NUMBER, `Номер точки — до ${MAX_POINT_NUMBER} символов`),
  name: z
    .string()
    .trim()
    .min(1, "Укажите название точки")
    .max(MAX_POINT_NAME, `Название точки — до ${MAX_POINT_NAME} символов`),
  description: optionalText(
    MAX_POINT_DESCRIPTION,
    `Описание точки — до ${MAX_POINT_DESCRIPTION} символов`,
  ),
});

const textsSchema = z.object({
  directions: optionalText(MAX_SCHEME_TEXT, `«Как добраться» — до ${MAX_SCHEME_TEXT} символов`),
  parking: optionalText(MAX_SCHEME_TEXT, `«Парковка» — до ${MAX_SCHEME_TEXT} символов`),
  onSiteNotes: optionalText(MAX_SCHEME_TEXT, `«На месте» — до ${MAX_SCHEME_TEXT} символов`),
  points: z
    .array(pointSchema)
    .max(MAX_SCHEME_POINTS, `Точек — не больше ${MAX_SCHEME_POINTS}`),
});

/** Схема, как её пишем в базу. Порядок точек — порядок в массиве. */
export type LocationSchemeData = {
  latitude: number | null;
  longitude: number | null;
  directions: string | null;
  parking: string | null;
  onSiteNotes: string | null;
  points: { number: string; name: string; description: string | null }[];
};

/** Поля формы как есть: строки, точки — JSON-строкой. */
export type LocationSchemeInput = {
  coordinates: unknown;
  directions: unknown;
  parking: unknown;
  onSiteNotes: unknown;
  points: unknown;
};

function asText(value: unknown): string | null {
  if (value == null) return "";
  return typeof value === "string" ? value : null;
}

/** Разбор формы схемы. Координаты — той же функцией, что в браузере. */
export function parseLocationScheme(
  raw: LocationSchemeInput,
): { data: LocationSchemeData } | { error: string } {
  const coordinatesText = asText(raw.coordinates);
  if (coordinatesText === null || coordinatesText.length > 100) {
    return { error: "Некорректные координаты" };
  }
  const coordinates = parseCoordinates(coordinatesText);
  if ("error" in coordinates) return coordinates;

  let points: unknown = raw.points ?? "[]";
  if (typeof points === "string") {
    try {
      points = JSON.parse(points);
    } catch {
      return { error: "Некорректные данные" };
    }
  }
  const parsed = textsSchema.safeParse({
    directions: asText(raw.directions),
    parking: asText(raw.parking),
    onSiteNotes: asText(raw.onSiteNotes),
    points,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Некорректные данные" };
  }
  return { data: { ...coordinates, ...parsed.data } };
}

/** Право правки схемы — как у правки карточки объекта: «Сценарий: правка». */
export function canEditLocationScheme(access: {
  can: (permission: "script:write") => boolean;
}): boolean {
  return access.can("script:write");
}

/** Проверка, что объект принадлежит проекту. false — чужой или нет записи. */
export type LocationInProjectCheck = (locationId: string) => Promise<boolean>;

/** Проверки сохранения схемы до записи: право, данные, объект — этого проекта. */
export async function checkLocationSchemeSave(
  deps: { canEdit: boolean; inProject: LocationInProjectCheck },
  locationId: unknown,
  raw: LocationSchemeInput,
): Promise<{ locationId: string; data: LocationSchemeData } | { error: string }> {
  if (!deps.canEdit) return { error: NO_RIGHTS };
  if (typeof locationId !== "string" || locationId.trim() === "" || locationId.length > 100) {
    return { error: LOCATION_NOT_FOUND };
  }
  const parsed = parseLocationScheme(raw);
  if ("error" in parsed) return parsed;
  if (!(await deps.inProject(locationId))) return { error: LOCATION_NOT_FOUND };
  return { locationId, data: parsed.data };
}

/** Для журнала: текст коротко. */
function brief(text: string | null): string | null {
  if (text === null) return null;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function pointLabel(point: LocationSchemeData["points"][number]): string {
  return `${point.number} ${point.name}`;
}

/**
 * Что поменялось в схеме — для журнала. null — ничего не поменялось, писать не нужно.
 * Тексты — коротко, точки — число и список «номер название».
 */
export function locationSchemeChanges(
  before: LocationSchemeData,
  after: LocationSchemeData,
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (before.latitude !== after.latitude || before.longitude !== after.longitude) {
    changes.coordinates = {
      from: before.latitude === null ? null : [before.latitude, before.longitude],
      to: after.latitude === null ? null : [after.latitude, after.longitude],
    };
  }
  for (const key of ["directions", "parking", "onSiteNotes"] as const) {
    if (before[key] !== after[key]) {
      changes[key] = { from: brief(before[key]), to: brief(after[key]) };
    }
  }
  if (JSON.stringify(before.points) !== JSON.stringify(after.points)) {
    changes.pointsCount = { from: before.points.length, to: after.points.length };
    changes.points = {
      from: before.points.map(pointLabel),
      to: after.points.map(pointLabel),
    };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}
