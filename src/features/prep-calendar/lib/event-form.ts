/** Час вперёд для «Окончание»; конец суток не переходит на следующий день. */
export function addHour(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour)) return time;
  return hour >= 23 ? "23:59" : `${String(hour + 1).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
