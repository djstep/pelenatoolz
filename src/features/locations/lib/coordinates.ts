/**
 * Координаты объекта — одно поле «Координаты», как копируют Яндекс и Google Карты:
 * «59.938, 30.314». Сначала широта, потом долгота.
 */

export const COORDINATES_FORMAT_ERROR =
  "Координаты — две цифры через запятую, например 59.938, 30.314";
export const LATITUDE_RANGE_ERROR = "Широта должна быть от −90 до 90";
export const LONGITUDE_RANGE_ERROR = "Долгота должна быть от −180 до 180";

export type Coordinates = { latitude: number | null; longitude: number | null };

/** Знаков после точки: 6 — около 10 см, точнее не нужно. */
const DIGITS = 6;

const NUMBER_PATTERN = /^[+-]?\d+(\.\d+)?$/;

function round(value: number): number {
  const rounded = Number(value.toFixed(DIGITS));
  // -0 после округления показываем и храним как 0.
  return rounded === 0 ? 0 : rounded;
}

/** Делит строку на две части. Десятичная запятая — только когда разделитель «;» или пробел. */
function splitParts(text: string): string[] {
  if (text.includes(";")) {
    return text.split(";").map((part) => part.trim().replace(",", "."));
  }
  const commas = text.split(",").length - 1;
  if (commas === 1) return text.split(",").map((part) => part.trim());
  return text.split(/\s+/).map((part) => part.replace(",", "."));
}

/**
 * Разбор поля «Координаты». Понимает «59.938, 30.314», «59.938,30.314», «59.938 30.314»,
 * «59.938; 30.314», «59,938 30,314», «59,938; 30,314», минус. Пусто — координат нет.
 */
export function parseCoordinates(input: string): Coordinates | { error: string } {
  // Знак «−» (как в текстах) — обычный минус; неразрывные пробелы — обычные.
  const text = input.replace(/[−–]/g, "-").replace(/\s+/g, " ").trim();
  if (text === "") return { latitude: null, longitude: null };

  const parts = splitParts(text);
  if (parts.length !== 2 || !parts.every((part) => NUMBER_PATTERN.test(part))) {
    return { error: COORDINATES_FORMAT_ERROR };
  }
  const [latitude, longitude] = parts.map(Number);
  if (latitude < -90 || latitude > 90) return { error: LATITUDE_RANGE_ERROR };
  if (longitude < -180 || longitude > 180) return { error: LONGITUDE_RANGE_ERROR };
  return { latitude: round(latitude), longitude: round(longitude) };
}

/** Координаты обратно в поле: «59.938, 30.314», до 6 знаков. Нет одной из двух — пусто. */
export function formatCoordinates(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string {
  if (latitude == null || longitude == null) return "";
  return `${round(latitude)}, ${round(longitude)}`;
}
