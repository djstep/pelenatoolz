import { SYSTEM_FINANCE_VARIABLES } from "@/features/finance/lib/variables";

/**
 * Действующее значение переменной — одно правило для настроек, сметы и расчётов:
 * своё значение задано — оно; пусто — у СМЕНЫ и СЕРИИ берётся из параметров проекта
 * (число съёмочных дней, число серий), у остальных — не задано (null, не 0).
 */
export function effectiveVariableValue(
  variable: { key: string; value: { toString(): string } | number | null },
  project: { shootingDaysCount: number | null; episodeCount: number | null },
): string | null {
  if (variable.value != null) return variable.value.toString();
  const def = SYSTEM_FINANCE_VARIABLES.find((v) => v.key === variable.key);
  if (def?.projectField === "shootingDaysCount") return project.shootingDaysCount?.toString() ?? null;
  if (def?.projectField === "episodeCount") return project.episodeCount?.toString() ?? null;
  return null;
}
