import { selectFields } from "@/shared/lib/finance-fields";

/**
 * Персонаж, снимок утверждённого актёра и актёр в браузере (`pickFinanceFields`).
 * Фин. поля — по фин. просмотру актёров (`canFinanceRead("actors")`).
 */

/** Колонки персонажа. Сырой `castSnapshot` в браузер не уходит — только разобранный снимок. */
export const CHARACTER_FIELDS = {
  open: [
    "id",
    "projectId",
    "name",
    "description",
    "roleRequirements",
    "roleType",
    "makeupOffsetMin",
    "costumeOffsetMin",
    "sourceCastingCandidateId",
    "createdAt",
    "updatedAt",
    "scenes",
    "castingCandidates",
    "actors",
    "_count",
  ],
  finance: [],
} as const;

/** Снимок утверждённого актёра (`CharacterCastSnapshot`). */
export const CAST_SNAPSHOT_FIELDS = {
  open: [
    "photoUrl",
    "lastName",
    "firstName",
    "middleName",
    "phone",
    "email",
    "agentName",
    "agentPhone",
    "agentEmail",
    "physicalParams",
    "skills",
    "riderNotes",
    "roleType",
    "contractorType",
    "gender",
    "approvedAt",
  ],
  finance: [
    "proposedRate",
    "proposedTerms",
    "shiftRate",
    "shiftHoursMin",
    "unpaidOvertimeMin",
    "taxPercent",
  ],
} as const;

/** Поля снимка, которые пишет «Сохранить снимок»: ставка и фин. условия — с фин. правкой актёров. */
export const CAST_SNAPSHOT_INPUT_FIELDS = {
  open: ["riderNotes", "skills"],
  finance: ["shiftRate", "proposedTerms"],
} as const;

/**
 * Карточка актёра: фин. условия — тот же блок, что пишется только с фин. правкой
 * (`updateActorAction`), плюс статьи сметы по умолчанию и «особые условия» (копия условий
 * кандидата при утверждении).
 */
export const ACTOR_FIELDS = {
  open: [
    "id",
    "projectId",
    "characterId",
    "lastName",
    "firstName",
    "middleName",
    "gender",
    "contractorType",
    "roleType",
    "phone1",
    "phone2",
    "email",
    "agentName",
    "agentPhone",
    "agentEmail",
    "carPickupTime",
    "arrivalTime",
    "pickupOffsetMin",
    "tags",
    "createdAt",
    "updatedAt",
  ],
  finance: [
    "specialConditions",
    "shiftRate",
    "shiftHoursMin",
    "unpaidOvertimeMin",
    "taxPercent",
    "overtimeMode",
    "unpaidOvertimeMode",
    "defaultBudgetItemId",
    "overtimeBudgetItemId",
    "overtimeRates",
    "extraPayments",
  ],
} as const;

const SCENE_CHARACTER_KEYS = [
  "id",
  "projectId",
  "name",
  "description",
  "roleRequirements",
  "roleType",
  "makeupOffsetMin",
  "costumeOffsetMin",
  "sourceCastingCandidateId",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (typeof CHARACTER_FIELDS.open)[number][];

/**
 * Персонаж в выборках сцен и списках для них (либретто, сценарий, КПП, вызывной) — вместо
 * `character: true`. Только открытые поля `CHARACTER_FIELDS`: сырой `castSnapshot` (в нём ставка
 * и условия актёра) из базы не берётся ни для кого — эти экраны снимок не показывают.
 */
export const SCENE_CHARACTER_SELECT = selectFields(SCENE_CHARACTER_KEYS);

const SCENE_ACTOR_KEYS = [
  "id",
  "projectId",
  "characterId",
  "lastName",
  "firstName",
  "middleName",
  "gender",
  "contractorType",
  "roleType",
  "phone1",
  "phone2",
  "email",
  "agentName",
  "agentPhone",
  "agentEmail",
  "carPickupTime",
  "arrivalTime",
  "pickupOffsetMin",
  "tags",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (typeof ACTOR_FIELDS.open)[number][];

/**
 * Актёр в вызывном и занятости актёров — вместо полной записи. Только открытые поля
 * `ACTOR_FIELDS`: эти экраны денег актёра не показывают, ставка и условия не берутся ни для кого.
 */
export const SCENE_ACTOR_SELECT = selectFields(SCENE_ACTOR_KEYS);
