import type { ActorAvailabilityStatus } from "@prisma/client";

export const availabilityStatusLabels: Record<ActorAvailabilityStatus, string> = {
  UNSET: "Не указано",
  FREE: "Свободен",
  BUSY_OTHER: "Занят (другой проект)",
  BUSY_OUR_PROJECT: "Занят (наш проект)",
  UNAVAILABLE: "Недоступен",
};

/** Ручной цикл клика (legacy). */
export const manualStatusCycle: ActorAvailabilityStatus[] = [
  "UNSET",
  "FREE",
  "BUSY_OTHER",
  "UNAVAILABLE",
];

/** Все статусы для редактора (включая ручную бронь на наш проект). */
export const editorStatusOptions: ActorAvailabilityStatus[] = [
  "UNSET",
  "FREE",
  "BUSY_OUR_PROJECT",
  "BUSY_OTHER",
  "UNAVAILABLE",
];

export function nextManualStatus(
  current: ActorAvailabilityStatus,
): ActorAvailabilityStatus {
  const idx = manualStatusCycle.indexOf(current);
  if (idx < 0) return manualStatusCycle[0];
  return manualStatusCycle[(idx + 1) % manualStatusCycle.length];
}

export function cellColorClass(
  status: ActorAvailabilityStatus,
  opts?: { kppAuto?: boolean },
): string {
  if (opts?.kppAuto || status === "BUSY_OUR_PROJECT") {
    return "bg-violet-500/35 border-violet-400/50 text-violet-100";
  }
  switch (status) {
    case "FREE":
      return "bg-emerald-500/30 border-emerald-400/45 text-emerald-100";
    case "BUSY_OTHER":
      return "bg-amber-500/35 border-amber-400/50 text-amber-100";
    case "UNAVAILABLE":
      return "bg-rose-500/35 border-rose-400/50 text-rose-100";
    default:
      return "bg-white/5 border-white/10 text-[var(--muted-fg)]";
  }
}

export type PlanningHint = "all_free" | "partial" | "none_free" | "neutral";

export const planningHintClass: Record<PlanningHint, string> = {
  all_free: "ring-2 ring-emerald-400/70 ring-offset-1 ring-offset-transparent",
  partial: "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-transparent",
  none_free: "ring-2 ring-rose-400/70 ring-offset-1 ring-offset-transparent",
  neutral: "",
};

export function toDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfWeekMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

export function eachDayInRange(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

export type AvailabilityViewMode = "week" | "2weeks" | "month" | "custom";

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function getViewDayCount(mode: AvailabilityViewMode, anchor: Date): number {
  switch (mode) {
    case "week":
      return 7;
    case "2weeks":
      return 14;
    case "month":
      return daysInMonth(anchor.getUTCFullYear(), anchor.getUTCMonth());
    default:
      return 7;
  }
}

export function getViewStartDate(mode: AvailabilityViewMode, anchor: Date): Date {
  if (mode === "month") {
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  }
  return startOfWeekMonday(anchor);
}

export function getViewDays(
  mode: AvailabilityViewMode,
  anchor: Date,
  customFrom?: string,
  customTo?: string,
): Date[] {
  if (mode === "custom" && customFrom && customTo) {
    const start = parseDateKey(customFrom);
    const end = parseDateKey(customTo);
    if (end < start) return [];
    const count =
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return eachDayInRange(start, Math.min(count, 120));
  }
  const start = getViewStartDate(mode, anchor);
  return eachDayInRange(start, getViewDayCount(mode, anchor));
}

export const manualStatusOptions = manualStatusCycle.map((value) => ({
  value,
  label: availabilityStatusLabels[value],
}));

export const editorStatusOptionsList = editorStatusOptions.map((value) => ({
  value,
  label: availabilityStatusLabels[value],
}));

export function cellShortLabel(
  status: ActorAvailabilityStatus,
  opts?: { kppAuto?: boolean },
): string {
  if (opts?.kppAuto) return "КПП";
  if (status === "BUSY_OUR_PROJECT") return "Наш";
  return availabilityStatusLabels[status].split(" ")[0].slice(0, 4);
}

export function shiftViewAnchor(
  mode: AvailabilityViewMode,
  anchor: Date,
  direction: -1 | 1,
): Date {
  const next = new Date(anchor);
  if (mode === "month") {
    next.setUTCMonth(next.getUTCMonth() + direction);
    return next;
  }
  const step = mode === "2weeks" ? 14 : 7;
  next.setUTCDate(next.getUTCDate() + step * direction);
  return next;
}
