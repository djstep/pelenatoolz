import { countOf } from "@/shared/lib/plural";

/** Выбранная сцена и где она используется. Слот дня без связи с днём (`ShootDayScene`) — не в счёт. */
export type SceneDeleteUsage = {
  label: string;
  cut: boolean;
  /** Дней КПП, где сцена стоит. */
  shootDays: number;
  /** Дней с отчётом смены, где по сцене есть строка факта или попытка съёмки. */
  reportDays: ReadonlySet<string>;
};

function scenesWord(labels: string[]) {
  return labels.length === 1 ? `Сцена ${labels[0]}` : `Сцены ${labels.join(", ")}`;
}

/**
 * Почему выбранные сцены нельзя удалить — по строке на причину; пусто — можно.
 * Удаление каскадом стёрло бы сцены из дней КПП и строки отчётов смены, поэтому отказ целиком.
 */
export function scenesDeleteRefusal(scenes: readonly SceneDeleteUsage[]): string[] {
  const lines: string[] = [];

  const inDays = scenes.filter((s) => s.shootDays > 0);
  if (inDays.length > 0) {
    const labels = inDays.map((s) => s.label);
    const one = labels.length === 1;
    const fix = inDays.every((s) => s.cut)
      ? `уберите ${one ? "её" : "их"} из дня`
      : `уберите ${one ? "её" : "их"} из дня или пометьте ${one ? "вырезанной" : "вырезанными"}`;
    lines.push(`${scenesWord(labels)} ${one ? "стоит" : "стоят"} в днях КПП — ${fix}`);
  }

  const inReports = scenes.filter((s) => s.reportDays.size > 0);
  if (inReports.length > 0) {
    const labels = inReports.map((s) => s.label);
    const days = new Set(inReports.flatMap((s) => [...s.reportDays])).size;
    lines.push(
      `${scenesWord(labels)} есть в отчётах смены (${countOf(days, ["день", "дня", "дней"])}) — удалить нельзя, пропадёт история съёмок`,
    );
  }

  const free = scenes.some((s) => s.shootDays === 0 && s.reportDays.size === 0);
  if (lines.length > 0 && free) {
    // Отказ целиком: остальные выбранные сцены тоже не удаляются.
    lines.push("Удалить нельзя ни одну из выбранных — уберите эти сцены из выбора");
  }
  return lines;
}
