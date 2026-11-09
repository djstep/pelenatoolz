import type { CSSProperties } from "react";

/** Набор цветов типов событий. Значения — переменные темы `--event-<ключ>-bg/-fg/-line`. */
export const PREP_EVENT_COLORS = [
  { key: "blue", label: "Синий" },
  { key: "green", label: "Зелёный" },
  { key: "amber", label: "Жёлтый" },
  { key: "red", label: "Красный" },
  { key: "violet", label: "Фиолетовый" },
  { key: "teal", label: "Бирюзовый" },
  { key: "pink", label: "Розовый" },
  { key: "gray", label: "Серый" },
] as const;

export type PrepEventColor = (typeof PREP_EVENT_COLORS)[number]["key"];

const COLOR_KEYS: readonly string[] = PREP_EVENT_COLORS.map((c) => c.key);

export function isPrepEventColor(value: string): value is PrepEventColor {
  return COLOR_KEYS.includes(value);
}

/** Плашка типа: заливка, текст и рамка из темы. Неизвестный ключ в базе — серый. */
export function prepEventColorStyle(color: string): CSSProperties {
  const key = isPrepEventColor(color) ? color : "gray";
  return {
    backgroundColor: `var(--event-${key}-bg)`,
    color: `var(--event-${key}-fg)`,
    borderColor: `var(--event-${key}-line)`,
  };
}
