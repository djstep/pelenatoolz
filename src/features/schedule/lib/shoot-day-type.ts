import type { ShootDayType } from "@prisma/client";

/** Вызывной и производственный отчёт формируются только для рабочих смен. */
export function isWorkingShootDay(dayType: ShootDayType | string): boolean {
  return dayType === "WORKING";
}
