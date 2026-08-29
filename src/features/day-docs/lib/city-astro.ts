import * as SunCalc from "suncalc";

type GeoResult = {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
};

export type DayAstro = {
  sunrise: string | null;
  sunset: string | null;
  label: string;
  weatherCode: number | null;
  precipProb: number | null;
  tempMax: number | null;
  tempMin: number | null;
  weatherSummary: string | null;
  /** True when only astronomical sun times are available (no weather forecast). */
  weatherUnavailable?: boolean;
};

const WEATHER_CODES: Record<number, string> = {
  0: "Ясно",
  1: "Преимущественно ясно",
  2: "Переменная облачность",
  3: "Пасмурно",
  45: "Туман",
  48: "Изморозь",
  51: "Морось",
  53: "Морось",
  55: "Морось",
  61: "Дождь",
  63: "Дождь",
  65: "Ливень",
  71: "Снег",
  73: "Снег",
  75: "Снегопад",
  80: "Ливень",
  81: "Ливень",
  82: "Ливень",
  95: "Гроза",
  96: "Гроза с градом",
  99: "Гроза с градом",
};

const FORECAST_HORIZON_DAYS = 16;

/** Calendar date YYYY-MM-DD in the project timezone (not UTC). */
export function calendarDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Europe/Moscow",
  }).format(date);
}

function formatTimeInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone || "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function daysFromToday(isoDate: string, timezone: string): number {
  const today = calendarDateInTimezone(new Date(), timezone);
  const a = new Date(`${today}T12:00:00Z`).getTime();
  const b = new Date(`${isoDate}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function calculateSunTimes(
  isoDate: string,
  lat: number,
  lon: number,
  timezone: string,
): { sunrise: string; sunset: string } {
  const noon = new Date(`${isoDate}T12:00:00Z`);
  const times = SunCalc.getTimes(noon, lat, lon);
  return {
    sunrise: times.sunrise ? formatTimeInTimezone(times.sunrise, timezone) : "—",
    sunset: times.sunset ? formatTimeInTimezone(times.sunset, timezone) : "—",
  };
}

type WeatherDaily = {
  weather_code?: number[];
  precipitation_probability_max?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
};

async function fetchWeatherDaily(
  baseUrl: string,
  lat: number,
  lon: number,
  isoDate: string,
  timezone: string,
): Promise<WeatherDaily | null> {
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "daily",
    "weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min",
  );
  url.searchParams.set("timezone", timezone || "Europe/Moscow");
  url.searchParams.set("start_date", isoDate);
  url.searchParams.set("end_date", isoDate);

  const res = await fetch(url.toString(), { next: { revalidate: 3_600 } });
  if (!res.ok) return null;
  const json = (await res.json()) as { daily?: WeatherDaily; error?: boolean };
  if (json.error || !json.daily?.weather_code?.length) return null;
  return json.daily;
}

function buildWeatherSummary(daily: WeatherDaily): {
  weatherCode: number | null;
  precipProb: number | null;
  tempMax: number | null;
  tempMin: number | null;
  weatherSummary: string | null;
} {
  const weatherCode = daily.weather_code?.[0] ?? null;
  const precipProb = daily.precipitation_probability_max?.[0] ?? null;
  const tempMax = daily.temperature_2m_max?.[0] ?? null;
  const tempMin = daily.temperature_2m_min?.[0] ?? null;

  const weatherLabel =
    weatherCode != null ? WEATHER_CODES[weatherCode] ?? "—" : null;
  const tempLabel =
    tempMax != null && tempMin != null
      ? `${Math.round(tempMin)}…${Math.round(tempMax)}°C`
      : null;
  const precipLabel =
    precipProb != null && precipProb > 0 ? `осадки ${precipProb}%` : null;
  const weatherSummary = [weatherLabel, tempLabel, precipLabel]
    .filter(Boolean)
    .join(", ");

  return { weatherCode, precipProb, tempMax, tempMin, weatherSummary: weatherSummary || null };
}

export async function fetchCityAstro(
  city: string | null | undefined,
  date: Date,
  timezone: string,
): Promise<DayAstro | null> {
  if (!city?.trim()) return null;

  const tz = timezone || "Europe/Moscow";

  try {
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", city.trim());
    geoUrl.searchParams.set("count", "1");
    geoUrl.searchParams.set("language", "ru");

    const geoRes = await fetch(geoUrl.toString(), {
      next: { revalidate: 86_400 },
    });
    if (!geoRes.ok) return null;
    const geoJson = (await geoRes.json()) as { results?: GeoResult[] };
    const place = geoJson.results?.[0];
    if (!place) return null;

    const iso = calendarDateInTimezone(date, tz);
    const sun = calculateSunTimes(iso, place.latitude, place.longitude, tz);
    const offsetDays = daysFromToday(iso, tz);

    let daily: WeatherDaily | null = null;
    if (offsetDays >= 0 && offsetDays <= FORECAST_HORIZON_DAYS) {
      daily = await fetchWeatherDaily(
        "https://api.open-meteo.com/v1/forecast",
        place.latitude,
        place.longitude,
        iso,
        tz,
      );
    } else if (offsetDays < 0) {
      daily = await fetchWeatherDaily(
        "https://archive-api.open-meteo.com/v1/archive",
        place.latitude,
        place.longitude,
        iso,
        tz,
      );
    }

    const weather = daily ? buildWeatherSummary(daily) : null;
    const weatherUnavailable = !weather?.weatherSummary;

    return {
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      label: [place.name, place.country].filter(Boolean).join(", "),
      weatherCode: weather?.weatherCode ?? null,
      precipProb: weather?.precipProb ?? null,
      tempMax: weather?.tempMax ?? null,
      tempMin: weather?.tempMin ?? null,
      weatherSummary: weatherUnavailable
        ? offsetDays > FORECAST_HORIZON_DAYS
          ? `прогноз погоды доступен за ${FORECAST_HORIZON_DAYS} дней`
          : null
        : weather!.weatherSummary,
      weatherUnavailable,
    };
  } catch {
    return null;
  }
}

function formatClock(isoLocal: string) {
  const time = isoLocal.includes("T") ? isoLocal.split("T")[1] : isoLocal;
  return time?.slice(0, 5) ?? null;
}

export { formatClock };
