/**
 * Объект (локация) в браузере (`pickFinanceFields`). Фин. поля — по фин. просмотру объектов
 * (`canFinanceRead("locations")`): тот же блок, что пишется только с фин. правкой.
 */
export const LOCATION_FIELDS = {
  open: [
    "id",
    "projectId",
    "name",
    "sublocation",
    "locationKind",
    "hasDecoration",
    "address",
    "tags",
    "notes",
    "requirementNotes",
    "scoutSnapshot",
    "sourceScoutCandidateId",
    "createdAt",
    "updatedAt",
    "scenes",
    "photos",
    "scoutCandidateLinks",
    "_count",
  ],
  finance: [
    "shiftRate",
    "shiftHoursMin",
    "unpaidOvertimeMin",
    "taxPercent",
    "overtimeMode",
    "unpaidOvertimeMode",
    "defaultBudgetItemId",
    "overtimeBudgetItemId",
    "overtimeRates",
  ],
} as const;

/** Снимок утверждённой площадки (`LocationScoutSnapshot`): стоимость — фин. условие объекта. */
export const SCOUT_SNAPSHOT_FIELDS = {
  open: ["title", "address", "contactName", "contactPhone", "photos", "videos", "notes", "approvedAt"],
  finance: ["cost"],
} as const;

/** Поля снимка, которые пишет «Сохранить снимок»: стоимость — с фин. правкой объектов. */
export const SCOUT_SNAPSHOT_INPUT_FIELDS = {
  open: ["address", "contactName", "contactPhone", "notes"],
  finance: ["cost"],
} as const;
