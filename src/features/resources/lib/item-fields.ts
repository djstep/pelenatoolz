import { selectFields } from "@/shared/lib/finance-fields";

/**
 * Позиция ресурса в браузере (`pickFinanceFields`). Фин. поля — по фин. просмотру её категории
 * (`canFinanceRead({ categoryId })`): тот же блок, что пишется только с фин. правкой.
 */
export const RESOURCE_ITEM_FIELDS = {
  open: [
    "id",
    "categoryId",
    "name",
    "notes",
    "arrivalOffsetMin",
    "createdAt",
    "updatedAt",
    "category",
    "sceneLinks",
    "_count",
    "sceneCount",
    "unshotSceneCount",
    "planSeconds",
    "unshotSeconds",
  ],
  finance: [
    "shiftRate",
    "shiftHoursMin",
    "unpaidOvertimeMin",
    "taxPercent",
    "overtimeMode",
    "unpaidOvertimeMode",
    "kmRate",
    "defaultBudgetItemId",
    "overtimeBudgetItemId",
    "mileageBudgetItemId",
    "overtimeRates",
    "extraPayments",
  ],
} as const;

const SCENE_RESOURCE_ITEM_KEYS = [
  "id",
  "categoryId",
  "name",
  "notes",
  "arrivalOffsetMin",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (typeof RESOURCE_ITEM_FIELDS.open)[number][];

/**
 * Позиция ресурса в выборках сцен и дня (либретто, КПП, вызывной) — вместо полной записи.
 * Только открытые поля `RESOURCE_ITEM_FIELDS`: ставка, км, налог не берутся ни для кого.
 */
export const SCENE_RESOURCE_ITEM_SELECT = selectFields(SCENE_RESOURCE_ITEM_KEYS);
