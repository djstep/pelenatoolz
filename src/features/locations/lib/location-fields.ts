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

const SCENE_LOCATION_KEYS = [
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
  "sourceScoutCandidateId",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (typeof LOCATION_FIELDS.open)[number][];

/**
 * Объект в выборках сцен (либретто, сценарий, КПП, вызывной) — вместо `location: true`.
 * Только открытые поля `LOCATION_FIELDS` (проверка типов не даст добавить фин. поле).
 * Эти экраны денег объекта не показывают, поэтому фин. поля и снимок скаута (в нём стоимость)
 * из базы не берутся ни для кого.
 */
export const SCENE_LOCATION_SELECT = Object.fromEntries(
  SCENE_LOCATION_KEYS.map((key) => [key, true]),
) as { readonly [K in (typeof SCENE_LOCATION_KEYS)[number]]: true };

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
