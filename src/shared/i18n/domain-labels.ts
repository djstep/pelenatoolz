import {
  ActorRoleType,
  ContractorType,
  DayNight,
  ElementType,
  Gender,
  IntExt,
  LocationKind,
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
  SHOT: "bg-green-600/20 text-green-300 border-green-500/30",
  RESHOOT_REQUIRED: "bg-yellow-600/20 text-yellow-200 border-yellow-500/30",
  PLANNING: "bg-zinc-500/20 text-zinc-300 border-zinc-400/30",
  OFF_PLAN: "bg-zinc-800/40 text-zinc-400 border-zinc-600/30",
  NOT_SHOT: "bg-red-600/20 text-red-300 border-red-500/30",
};

export const sceneStatusRowColors: Record<SceneStatus, string> = {
  SHOT: "bg-green-950/35 hover:bg-green-950/45",
  RESHOOT_REQUIRED: "bg-yellow-950/35 hover:bg-yellow-950/45",
  PLANNING: "bg-zinc-900/40 hover:bg-zinc-900/50",
  OFF_PLAN: "bg-black/50 hover:bg-black/60",
  NOT_SHOT: "bg-red-950/35 hover:bg-red-950/45",
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

export const elementTypeLabels: Record<ElementType, string> = {
  PROP: "Реквизит",
  VEHICLE: "Транспорт",
  WARDROBE: "Костюм",
  SFX: "SFX",
  MAKEUP: "Грим",
  COSTUME: "Костюм",
  OTHER: "Другое",
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

export const contractorTypeLabels: Record<ContractorType, string> = {
  IP: "ИП",
  INDIVIDUAL: "Физ. лицо",
  SELF_EMPLOYED: "Самозанятый",
  UNKNOWN: "Неизвестно",
};

export const genderLabels: Record<Gender, string> = {
  MALE: "Мужской",
  FEMALE: "Женский",
  OTHER: "Другое",
};

export function formatSecondsMmSs(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
