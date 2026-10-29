/** Статья сметы для выпадающих списков и подписей. */
export type BudgetItemOption = {
  id: string;
  code: string;
  name: string;
  departmentName: string;
  archived: boolean;
  /** Статья из сметы, которую пользователь не видит: код и название не показываются. */
  hidden?: boolean;
};

export function budgetItemLabel(item: BudgetItemOption | undefined | null): string {
  if (!item) return "Без статьи";
  if (item.hidden) return "Статья другого цеха";
  return `${item.code} · ${item.name}${item.archived ? " (в архиве)" : ""}`;
}
