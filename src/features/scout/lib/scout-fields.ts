/**
 * Кандидат скаута в браузере (`pickFinanceFields`). Стоимость площадки — фин. условие объекта
 * (`canFinanceRead("locations")`), остальное — по праву просмотра сцен.
 */
export const SCOUT_CANDIDATE_FIELDS = {
  open: [
    "id",
    "projectId",
    "title",
    "address",
    "contactName",
    "contactPhone",
    "photos",
    "videos",
    "notes",
    "status",
    "statusChangedAt",
    "createdAt",
    "updatedAt",
    "locationLinks",
  ],
  finance: ["cost"],
} as const;

/** Поля формы кандидата, которые сервер пишет: стоимость — только с фин. правкой объектов. */
export const SCOUT_CANDIDATE_INPUT_FIELDS = {
  open: [
    "locationIds",
    "title",
    "address",
    "contactName",
    "contactPhone",
    "notes",
    "photoUrls",
    "videoUrls",
  ],
  finance: ["cost"],
} as const;
