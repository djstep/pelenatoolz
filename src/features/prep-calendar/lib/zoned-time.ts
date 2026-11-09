/**
 * Время событий: в базе момент (`timestamptz`), для людей — часы по поясу проекта, а не по
 * компьютеру зрителя. Все переводы здесь, остальной код работает с «ГГГГ-ММ-ДД» и «ЧЧ:ММ».
 */

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function partsInZone(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

/** День и часы момента по поясу проекта. */
export function zonedDateTime(date: Date, timeZone: string): { dateKey: string; time: string } {
  const p = partsInZone(date, timeZone);
  return {
    dateKey: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Сегодня по поясу проекта. */
export function todayDateKey(timeZone: string, now: Date = new Date()): string {
  return zonedDateTime(now, timeZone).dateKey;
}

/** Смещение пояса в этот момент, мс. Секунды отбрасываются: они есть только у старых дат. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = partsInZone(new Date(instant), timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(instant / 60_000) * 60_000;
}

/**
 * Момент для часов в поясе проекта. Смещение уточняется вторым проходом: без него время рядом
 * с переводом часов ушло бы на час. Несуществующий час весенней ночи сдвигается вперёд.
 */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year!, month! - 1, day, hour, minute);
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone));
}
