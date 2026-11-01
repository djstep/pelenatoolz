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
