/** Field catalogs for cast-list export (character header + actor blocks). */

export type CastListCharacterFieldId =
  | "name"
  | "description"
  | "roleRequirements"
  | "roleType";

export type CastListActorFieldId =
  | "photo"
  | "fullName"
  | "age"
  | "education"
  | "filmography"
  | "physicalParams"
  | "skills"
  | "phone"
  | "email"
  | "agent"
  | "status"
  | "rating"
  | "notes";

export const CAST_LIST_CHARACTER_FIELDS: {
  id: CastListCharacterFieldId;
  label: string;
}[] = [
  { id: "name", label: "Имя персонажа" },
  { id: "description", label: "Описание" },
  { id: "roleRequirements", label: "Типаж / требования" },
  { id: "roleType", label: "Тип роли" },
];

export const CAST_LIST_ACTOR_FIELDS: {
  id: CastListActorFieldId;
  label: string;
}[] = [
  { id: "photo", label: "Фото" },
  { id: "fullName", label: "ФИО" },
  { id: "age", label: "Возраст" },
  { id: "education", label: "Образование" },
  { id: "filmography", label: "Фильмография" },
  { id: "physicalParams", label: "Физические параметры" },
  { id: "skills", label: "Умения" },
  { id: "phone", label: "Телефон" },
  { id: "email", label: "Email" },
  { id: "agent", label: "Агент" },
  { id: "status", label: "Статус в кастинге" },
  { id: "rating", label: "Оценка" },
  { id: "notes", label: "Заметки" },
];

export const DEFAULT_CHARACTER_FIELD_IDS: CastListCharacterFieldId[] = [
  "name",
  "description",
  "roleRequirements",
];

export const DEFAULT_ACTOR_FIELD_IDS: CastListActorFieldId[] = [
  "photo",
  "fullName",
  "age",
  "education",
  "filmography",
  "physicalParams",
  "skills",
];

export type CastListSort =
  | "nameAsc"
  | "nameDesc"
  | "ratingDesc"
  | "status"
  | "createdAt";

export const CAST_LIST_SORT_OPTIONS: { id: CastListSort; label: string }[] = [
  { id: "nameAsc", label: "ФИО А→Я" },
  { id: "nameDesc", label: "ФИО Я→А" },
  { id: "ratingDesc", label: "Оценка (выше сначала)" },
  { id: "status", label: "Статус кастинга" },
  { id: "createdAt", label: "Дата добавления" },
];

export type CastListExportTapeItem =
  | {
      id: string;
      kind: "audition";
      auditionId: string;
    }
  | {
      id: string;
      kind: "external";
      url: string;
      note: string;
    };

export type CastListCandidateExportConfig = {
  candidateId: string;
  photoOverrideUrl: string | null;
  tapes: CastListExportTapeItem[];
  /** null = auto-include all comments (including future ones in UI state) */
  commentIds: string[] | null;
  commentsManual: boolean;
};
