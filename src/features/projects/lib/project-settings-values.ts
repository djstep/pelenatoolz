import type { Project } from "@prisma/client";

type DecimalField = "pageToMinuteRatio" | "plannedDailyOutputMin" | "filmCoefficient";

/** Проект для формы «Основные параметры» (клиентский компонент): Decimal → число. */
export type ProjectSettingsValues = Omit<Project, DecimalField> & {
  pageToMinuteRatio: number;
  plannedDailyOutputMin: number | null;
  filmCoefficient: number | null;
};

/** В клиентский компонент — только простые значения: Prisma Decimal туда не передаётся. */
export function projectSettingsValues(project: Project): ProjectSettingsValues {
  return {
    ...project,
    pageToMinuteRatio: Number(project.pageToMinuteRatio),
    plannedDailyOutputMin: project.plannedDailyOutputMin == null ? null : Number(project.plannedDailyOutputMin),
    filmCoefficient: project.filmCoefficient == null ? null : Number(project.filmCoefficient),
  };
}
