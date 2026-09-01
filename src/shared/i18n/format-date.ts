type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Короткая дата с годом: «3 мар. 2026 г.» */
export function formatDateShort(
  value: DateInput,
  opts?: { utc?: boolean },
): string {
  const d = toDate(value);
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: opts?.utc ? "UTC" : undefined,
  });
}

/** Длинная дата с годом: «вторник, 3 марта 2026 г.» */
export function formatDateLong(value: DateInput): string {
  const d = toDate(value);
  return d.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Дата и время с годом: «03 мар. 2026 г., 14:30» */
export function formatDateTimeShort(value: DateInput): string {
  const d = toDate(value);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCalendarColumnHeader(
  value: DateInput,
  opts?: { utc?: boolean },
): { weekday: string; dateLine: string } {
  const d = toDate(value);
  const base: Intl.DateTimeFormatOptions = opts?.utc ? { timeZone: "UTC" } : {};
  return {
    weekday: d.toLocaleDateString("ru-RU", { ...base, weekday: "short" }),
    dateLine: d.toLocaleDateString("ru-RU", {
      ...base,
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
  };
}

/** Диапазон дат с годом: «3–16 мар. 2026 г.» или «28 дек. 2025 г. – 5 янв. 2026 г.» */
export function formatDateRange(start: DateInput, end: DateInput, opts?: { utc?: boolean }): string {
  const a = toDate(start);
  const b = toDate(end);
  const base: Intl.DateTimeFormatOptions = opts?.utc ? { timeZone: "UTC" } : {};
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();

  if (sameMonth) {
    const monthYear = a.toLocaleDateString("ru-RU", {
      ...base,
      month: "short",
      year: "numeric",
    });
    return `${a.getUTCDate()}–${b.getUTCDate()} ${monthYear}`;
  }

  if (sameYear) {
    const startStr = a.toLocaleDateString("ru-RU", { ...base, day: "numeric", month: "short" });
    const endStr = b.toLocaleDateString("ru-RU", {
      ...base,
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${startStr} – ${endStr}`;
  }

  return `${formatDateShort(a, opts)} – ${formatDateShort(b, opts)}`;
}
