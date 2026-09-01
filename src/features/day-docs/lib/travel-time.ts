type GeoPoint = { lat: number; lon: number };

async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "ru");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: Array<{ latitude: number; longitude: number }>;
  };
  const hit = data.results?.[0];
  if (!hit) return null;
  return { lat: hit.latitude, lon: hit.longitude };
}

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Оценка времени переезда между адресами (мин). */
export async function estimateTravelMinutes(
  fromAddress: string,
  toAddress: string,
): Promise<{ minutes: number; source: "geocode" | "fallback" }> {
  const from = fromAddress.trim();
  const to = toAddress.trim();
  if (!from || !to) {
    return { minutes: 30, source: "fallback" };
  }
  if (from.toLowerCase() === to.toLowerCase()) {
    return { minutes: 15, source: "fallback" };
  }

  const [fromGeo, toGeo] = await Promise.all([
    geocodeAddress(from),
    geocodeAddress(to),
  ]);

  if (!fromGeo || !toGeo) {
    return { minutes: 45, source: "fallback" };
  }

  const km = haversineKm(fromGeo, toGeo);
  const driveMinutes = (km / 35) * 60;
  const total = Math.round(driveMinutes + 15);
  return {
    minutes: Math.min(180, Math.max(15, total)),
    source: "geocode",
  };
}

export function scenePrimaryAddress(scene: {
  locations: Array<{ location: { name: string; address: string | null } }>;
}): string | null {
  const loc = scene.locations[0]?.location;
  if (!loc) return null;
  return loc.address?.trim() || loc.name.trim() || null;
}
