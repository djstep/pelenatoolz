/**
 * Статус и версия на листе вызывного (печать, просмотр, Excel) — в шапке первого листа, подвала
 * у листа нет. В модель листа не входят:
 * снимок утверждения и отпечаток данных дня от статуса не зависят.
 */

import type { CallSheetStatusValue } from "@/features/call-sheets/lib/revision";

export type CallSheetStamp =
  | { status: "APPROVED"; version: number; /** «10.09 17:46» */ approvedAtLabel: string }
  | { status: "DRAFT" | "IN_REVIEW"; /** null — вызывной ещё не создан. */ version: number | null };

export const CALL_SHEET_STATUS_LABELS: Record<CallSheetStatusValue, string> = {
  DRAFT: "Черновик",
  IN_REVIEW: "На согласовании",
  APPROVED: "Утверждён",
};

/** Заметная метка в шапке у неутверждённого: «ЧЕРНОВИК», «НА СОГЛАСОВАНИИ». */
export function stampMark(stamp: CallSheetStamp | undefined): string | null {
  if (!stamp || stamp.status === "APPROVED") return null;
  return CALL_SHEET_STATUS_LABELS[stamp.status].toUpperCase();
}

/**
 * Строка сведений шапки: утверждённый — «версия 2 · утверждён 10.09 17:46», неутверждённый —
 * «версия N» (статус — меткой `stampMark`).
 */
export function stampVersion(stamp: CallSheetStamp | undefined): string | null {
  if (!stamp?.version) return null;
  if (stamp.status === "APPROVED") {
    return `версия ${stamp.version} · утверждён ${stamp.approvedAtLabel}`;
  }
  return `версия ${stamp.version}`;
}

/** «10.09 17:46» в часовом поясе проекта. */
export function formatApprovedAt(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}.${part("month")} ${part("hour")}:${part("minute")}`;
}
