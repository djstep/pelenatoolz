import { currencyForCountry } from "@/features/projects/lib/country-currency";

export type CitySearchResult = {
  id: number;
  name: string;
  label: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
  timezone?: string;
  currency?: string;
  latitude: number;
  longitude: number;
};

type OpenMeteoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
};

function normalizeText(value: string) {
  return value.normalize("NFC").toLowerCase();
}

function startsWithName(name: string, query: string) {
  return normalizeText(name).startsWith(normalizeText(query));
}

export function formatCityLabel(place: {
  name: string;
  country?: string;
  admin1?: string;
}) {
  const parts = [place.name];
  if (place.admin1 && place.admin1 !== place.name) {
    parts.push(place.admin1);
  }
  if (place.country) {
    parts.push(place.country);
  }
  return parts.join(", ");
}

function toCityResult(place: OpenMeteoResult): CitySearchResult {
  const countryCode = place.country_code?.toUpperCase();
  return {
    id: place.id,
    name: place.name,
    label: formatCityLabel(place),
    country: place.country,
    countryCode,
    admin1: place.admin1,
    timezone: place.timezone,
    currency: currencyForCountry(countryCode) ?? undefined,
    latitude: place.latitude,
    longitude: place.longitude,
  };
}

export async function searchCities(query: string, limit = 10): Promise<CitySearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", String(Math.max(limit, 20)));
  url.searchParams.set("language", "ru");

  const response = await fetch(url.toString(), {
    next: { revalidate: 86_400 },
  });
  if (!response.ok) return [];

  const json = (await response.json()) as { results?: OpenMeteoResult[] };
  const results = (json.results ?? []).map(toCityResult);

  const prefixMatches = results.filter((place) => startsWithName(place.name, trimmed));
  const ordered = prefixMatches.length > 0 ? prefixMatches : results;

  const unique = new Map<number, CitySearchResult>();
  for (const place of ordered) {
    unique.set(place.id, place);
  }

  return [...unique.values()].slice(0, limit);
}
