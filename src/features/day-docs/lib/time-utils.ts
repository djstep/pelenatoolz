/** Добавляет минуты к времени HH:mm (циклически в пределах суток). */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  let total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  total = ((total % 1440) + 1440) % 1440;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export function minutesBetweenTimes(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : 0;
}

export function defaultArrivalTime(
  shiftStartTime: string | null | undefined,
  callTime: string | null | undefined,
  arrivalOffsetMin: number | null | undefined,
): string | null {
  const base = shiftStartTime ?? callTime;
  if (!base) return null;
  return addMinutesToTime(base, arrivalOffsetMin ?? 0);
}

/** Нормализует введённое время к ЧЧ:ММ или возвращает как есть при ошибке. */
export function normalizeHhMm(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const [h, m] = trimmed.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || m >= 60) return trimmed;
  const total = h * 60 + m;
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}
