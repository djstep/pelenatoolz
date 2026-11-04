import {
  ActorRoleType,
  DayNight,
  IntExt,
  LocationKind,
  ProductionSceneFactStatus,
  ProjectStatus,
  ProjectType,
  SceneKind,
  SceneStatus,
  ShootDayStatus,
  ShootDayType,
  TimingMode,
} from "@prisma/client";

export const projectTypeLabels: Record<ProjectType, string> = {
  FEATURE: "Полнометражный фильм",
  SERIES: "Сериал",
  SHORT: "Короткометражный фильм",
};

export const projectStatusLabels: Record<ProjectStatus, string> = {
  DRAFT: "Черновик",
  PREPROD: "Подготовка",
  SHOOTING: "Съёмки",
  POST: "Постпродакшн",
  DONE: "Завершён",
  ARCHIVED: "Архив",
};

export const timingModeLabels: Record<TimingMode, string> = {
  MINUTES: "словах",
  PAGES: "страницах",
  IMPORTED: "импорте",
  MANUAL: "ручном вводе",
};

export const timingModeOptionLabels: Record<TimingMode, string> = {
  MINUTES: "По словам",
  PAGES: "По страницам",
  IMPORTED: "Из файла",
  MANUAL: "Вручную",
};

export const sceneStatusLabels: Record<SceneStatus, string> = {
  SHOT: "снято",
  RESHOOT_REQUIRED: "требуется досъём",
  PLANNING: "планирование",
  OFF_PLAN: "вне плана",
  NOT_SHOT: "не снято",
};

export const sceneStatusColors: Record<SceneStatus, string> = {
  SHOT: "bg-[var(--tone-success-bg)] text-[var(--tone-success)] border-[var(--tone-success-line)]",
  RESHOOT_REQUIRED: "bg-[var(--tone-warning-bg)] text-[var(--tone-warning-soft)] border-[var(--tone-warning-line)]",
  PLANNING: "bg-[var(--glass-badge-bg)] text-[var(--tone-neutral)] border-[var(--border)]",
  OFF_PLAN: "bg-[var(--badge-muted-bg)] text-[var(--muted-fg)] border-[var(--border)]",
  NOT_SHOT: "bg-[var(--tone-danger-bg)] text-[var(--tone-danger)] border-[var(--tone-danger-line)]",
};

export const sceneStatusRowColors: Record<SceneStatus, string> = {
  SHOT: "bg-[var(--row-success)] hover:bg-[var(--row-success-hover)]",
  RESHOOT_REQUIRED: "bg-[var(--row-warning)] hover:bg-[var(--row-warning-hover)]",
  PLANNING: "bg-[var(--row-neutral)] hover:bg-[var(--row-neutral-hover)]",
  OFF_PLAN: "bg-[var(--row-muted)] hover:bg-[var(--row-muted-hover)]",
  NOT_SHOT: "bg-[var(--row-danger)] hover:bg-[var(--row-danger-hover)]",
};

/** Цвета статусов факта отчёта — те же, что у SceneStatus в либретто. */
export const productionSceneFactStatusColors: Record<
  ProductionSceneFactStatus,
  string
> = {
  SHOT: sceneStatusColors.SHOT,
  NOT_SHOT: sceneStatusColors.NOT_SHOT,
  RESHOOT_REQUIRED: sceneStatusColors.RESHOOT_REQUIRED,
  DELETED: sceneStatusColors.OFF_PLAN,
};

export const locationKindLabels: Record<LocationKind, string> = {
  EXT: "Нат",
  INT: "Инт",
  INT_EXT: "Нат/Инт",
  PAV: "Пав",
};

export const sceneKindLabels: Record<SceneKind, string> = {
  SCENE: "Сцена",
  SOUND_DUB: "Звуковой дубль",
  MASTER_SHOT: "Заявочный план",
  FOOTAGE: "Футаж",
};

export const intExtLabels: Record<IntExt, string> = {
  INT: "Инт",
  EXT: "Нат",
  INT_EXT: "Нат/Инт",
};

export const dayNightLabels: Record<DayNight, string> = {
  DAY: "День",
  NIGHT: "Ночь",
  DAWN: "Рассвет",
  DUSK: "Закат",
};

export const shootDayStatusLabels: Record<ShootDayStatus, string> = {
  PLANNED: "План",
  CONFIRMED: "Подтверждён",
  SHOT: "Снят",
  CANCELLED: "Отменён",
};

export const shootDayTypeLabels: Record<ShootDayType, string> = {
  WORKING: "Рабочий день",
  OFF: "Выходной",
  REST: "Отсыпной",
  PREP: "Подготовительный",
};

export const actorRoleTypeLabels: Record<ActorRoleType, string> = {
  LEAD: "Главная",
  SUPPORTING: "Второго плана",
  EPISODIC: "Эпизодическая",
};

/**
 * Хронометраж «М:СС» — одна функция для всей системы (КПП, вызывной на экране, печать, Excel):
 * минуты без нуля впереди и без часов, секунды двумя цифрами — 0:23, 12:05, 62:05.
 * Пусто, 0 и меньше — «—».
 */
export function formatSecondsMmSs(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Total minutes as HH:mm (e.g. 720 → "12:00"). */
export function formatMinutesHhMm(totalMinutes: number | null | undefined): string {
  if (totalMinutes == null || totalMinutes < 0) return "";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Parse HH:mm (or legacy plain minutes) into total minutes. */
export function parseHhMmToMinutes(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d{1,3}):(\d{2})/);
  if (!match) return undefined;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (Number.isNaN(h) || Number.isNaN(m) || m >= 60) return undefined;
  return h * 60 + m;
}

export function parseMmSs(value: string): number | undefined {
  const match = value.trim().match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return undefined;
  const minutes = parseInt(match[1]!, 10);
  const seconds = parseInt(match[2]!, 10);
  if (seconds >= 60) return undefined;
  return minutes * 60 + seconds;
}
