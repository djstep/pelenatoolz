export type CalendarParticipantKind = "crew" | "actor" | "candidate";

export type CalendarParticipant = {
  kind: CalendarParticipantKind;
  id: string;
  label: string;
};

/** Событие для экрана. Дни и часы уже по поясу проекта, браузер их не пересчитывает. */
export type CalendarEvent = {
  id: string;
  title: string;
  type: { id: string; name: string; color: string };
  allDay: boolean;
  startKey: string;
  endKey: string;
  /** Только у событий со временем, иначе null. */
  startTime: string | null;
  endTime: string | null;
  locationText: string | null;
  locationId: string | null;
  /** Название объекта из «Локаций». */
  locationName: string | null;
  note: string | null;
  participants: CalendarParticipant[];
  /** Кандидаты, чьи имена зрителю не положены: остальное о них в браузер не уходит. */
  hiddenCandidates: number;
  departments: { id: string; name: string }[];
};

export type CalendarOption = { id: string; label: string; hint?: string };

/** Варианты для окна события. Списка нет — значит, нет права на этот вид. */
export type CalendarOptions = {
  types: { id: string; name: string; color: string; isHidden: boolean }[];
  crew: CalendarOption[] | null;
  actors: CalendarOption[] | null;
  candidates: CalendarOption[] | null;
  locations: CalendarOption[] | null;
  departments: { id: string; name: string }[];
};

export type NewEventPreset = {
  dateKey: string;
  allDay: boolean;
  /** Час клика в неделе. */
  time?: string;
};

/** Откуда подтянута запись. Свои события сюда не входят. */
export type PulledSource = "auditionPlan" | "auditionTape" | "kppPrep";

export const PULLED_LABELS: Record<PulledSource, { kind: string; from: string }> = {
  auditionPlan: { kind: "План проб", from: "из кастинга" },
  auditionTape: { kind: "Запись пробы", from: "из кастинга" },
  kppPrep: { kind: "Подготовительный день", from: "из КПП" },
};

/**
 * Запись из другого модуля: только для чтения, щелчок ведёт на источник. Приходит только
 * тому, у кого есть право смотреть этот источник.
 */
export type PulledItem = {
  pulled: true;
  /** С приставкой источника: id разных таблиц не совпадут. */
  id: string;
  source: PulledSource;
  title: string;
  href: string;
  allDay: boolean;
  startKey: string;
  endKey: string;
  startTime: string | null;
  endTime: string | null;
  people: string[];
  note: string | null;
};

export type CalendarItem = CalendarEvent | PulledItem;

export function isPulled(item: CalendarItem): item is PulledItem {
  return "pulled" in item;
}

/** Переключатели источников: null — нет права, переключателя нет. */
export type PulledSources = { auditions: boolean | null; kpp: boolean | null };
