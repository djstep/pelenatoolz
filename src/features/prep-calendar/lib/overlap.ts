/**
 * Пересекаются ли два отрезка времени. Встык (одно кончилось, другое началось) — нет.
 * События «весь день» сравниваются только между собой: с событием со временем — никогда.
 */
export function timesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Дни «ГГГГ-ММ-ДД», оба края включены. */
export function daysOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
