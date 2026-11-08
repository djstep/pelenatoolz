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
