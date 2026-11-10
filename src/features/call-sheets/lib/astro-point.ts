import {
  formatLocationTitle,
  type LocationNameSource,
} from "@/features/locations/lib/format-location";

type PlaceWithCoordinates = LocationNameSource & {
  latitude: number | null;
  longitude: number | null;
};

export type AstroPoint = { latitude: number; longitude: number; label: string };

function pointOf(place: PlaceWithCoordinates | null | undefined): AstroPoint | null {
  if (!place || place.latitude == null || place.longitude == null) return null;
  return {
    latitude: place.latitude,
    longitude: place.longitude,
    label: formatLocationTitle(place, ". "),
  };
}

/**
 * Где считать восход и закат: объект схемы вызывного, иначе первый объект сцен дня
 * с координатами. null — координат нет, считать по городу проекта.
 */
export function pickAstroPoint(
  schemeLocation: PlaceWithCoordinates | null | undefined,
  dayLocations: readonly PlaceWithCoordinates[],
): AstroPoint | null {
  const scheme = pointOf(schemeLocation);
  if (scheme) return scheme;
  for (const place of dayLocations) {
    const point = pointOf(place);
    if (point) return point;
  }
  return null;
}
