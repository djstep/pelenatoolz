/** Статусы согласования «из коробки» — свой набор, без копирования чужих формулировок. */
export const DEFAULT_APPROVAL_STATUSES = [
  {
    key: "UNSIGNED",
    name: "Не подписан",
    color: "#94a3b8",
    sortOrder: 10,
  },
  {
    key: "IN_REVIEW",
    name: "На согласовании",
    color: "#f59e0b",
    sortOrder: 20,
  },
  {
    key: "APPROVED",
    name: "Согласован",
    color: "#0ea5e9",
    sortOrder: 30,
  },
  {
    key: "SIGNED_SCAN",
    name: "Подписан (скан)",
    color: "#14b8a6",
    sortOrder: 40,
  },
  {
    key: "SIGNED_ORIGINAL",
    name: "Подписан (оригинал)",
    color: "#22c55e",
    sortOrder: 50,
  },
  {
    key: "REJECTED",
    name: "Отклонён",
    color: "#f43f5e",
    sortOrder: 60,
  },
] as const;

export type DefaultApprovalStatusKey =
  (typeof DEFAULT_APPROVAL_STATUSES)[number]["key"];

export const APPROVAL_STATUS_COLOR_PRESETS = [
  "#94a3b8",
  "#f59e0b",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#f43f5e",
  "#a78bfa",
  "#fb923c",
  "#64748b",
  "#e11d48",
] as const;

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export function normalizeApprovalColor(value: string): string | null {
  const t = value.trim();
  if (!HEX_COLOR.test(t)) return null;
  return t.toLowerCase();
}
