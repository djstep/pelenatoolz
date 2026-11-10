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
    // Объект — пусто; подобъект — объект-родитель (только id и название).
    "parentId",
    "parent",
    "sortOrder",
    "locationKind",
    "hasDecoration",
    "address",
    "tags",
    "notes",
    "requirementNotes",
    "scoutSnapshot",
    "sourceScoutCandidateId",
    // Схема объекта для вызывного (волна 3): координаты, тексты, точки.
    "latitude",
    "longitude",
    "directions",
    "parking",
    "onSiteNotes",
    "points",
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

/** Объект-родитель подобъекта: для подписи «ОБЪЕКТ.ПОДОБЪЕКТ» (`formatLocationTitle`). */
export const LOCATION_PARENT_SELECT = { select: { id: true, name: true } } as const;

/**
 * Родитель с реальным местом (адрес, координаты): подобъект без своего адреса берёт место
 * объекта (`placeOf`). Только открытые поля.
 */
export const LOCATION_PARENT_PLACE_SELECT = {
  select: { id: true, name: true, address: true, latitude: true, longitude: true },
} as const;

const SCENE_LOCATION_KEYS = [
  "id",
  "projectId",
  "name",
  "sublocation",
  // Порядок подобъекта внутри объекта (`compareLocations`).
  "sortOrder",
  "locationKind",
  "hasDecoration",
  "address",
  "tags",
  "notes",
  "requirementNotes",
  "sourceScoutCandidateId",
  // Восход и закат в вызывном — по координатам объекта сцены (волна 3).
  "latitude",
  "longitude",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (typeof LOCATION_FIELDS.open)[number][];

/**
 * Объект схемы в вызывном (волна 3): адрес, координаты, «как добраться», «парковка»,
 * «на месте». Только открытые поля; точки схемы выбираются отдельно.
 */
const CALL_SHEET_SCHEME_LOCATION_KEYS = [
  "id",
  "name",
  "sublocation",
  "latitude",
  "longitude",
  "address",
  "directions",
  "parking",
  "onSiteNotes",
] as const satisfies readonly (typeof LOCATION_FIELDS.open)[number][];

export const CALL_SHEET_SCHEME_LOCATION_SELECT = {
  ...(Object.fromEntries(CALL_SHEET_SCHEME_LOCATION_KEYS.map((key) => [key, true])) as {
    readonly [K in (typeof CALL_SHEET_SCHEME_LOCATION_KEYS)[number]]: true;
  }),
  // Схема подобъекта без своего адреса — схема объекта: адрес, координаты, тексты, точки.
  parent: {
    select: {
      ...LOCATION_PARENT_PLACE_SELECT.select,
      directions: true,
      parking: true,
      onSiteNotes: true,
      points: {
        orderBy: { sortOrder: "asc" },
        select: { number: true, name: true, description: true },
      },
    },
  },
} as const;

/**
 * Объект в выборках сцен (либретто, сценарий, КПП, вызывной) — вместо `location: true`.
 * Только открытые поля `LOCATION_FIELDS` (проверка типов не даст добавить фин. поле).
 * Эти экраны денег объекта не показывают, поэтому фин. поля и снимок скаута (в нём стоимость)
 * из базы не берутся ни для кого.
 */
export const SCENE_LOCATION_SELECT = {
  ...(Object.fromEntries(SCENE_LOCATION_KEYS.map((key) => [key, true])) as {
    readonly [K in (typeof SCENE_LOCATION_KEYS)[number]]: true;
  }),
  parent: LOCATION_PARENT_PLACE_SELECT,
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
