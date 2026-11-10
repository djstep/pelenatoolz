/**
 * Строка сметы для выпадающих списков и подписей. Внутреннего кода здесь нет: на экране его не
 * показывают нигде (он только в Excel), поэтому он и не уходит в браузер.
 */
export type BudgetItemOption = {
  id: string;
  name: string;
  /** Где строка: «Статья / Подстатья»; у записи старой табличной сметы — «Прежняя таблица». */
  path: string;
  departmentName: string;
  archived: boolean;
  /** Строка из сметы, которую пользователь не видит: название и место не показываются. */
  hidden?: boolean;
};

export function budgetItemLabel(item: BudgetItemOption | undefined | null): string {
  if (!item) return "Без статьи";
  if (item.hidden) return "Статья другого цеха";
  return `${item.name} · ${item.path}${item.archived ? " (в архиве)" : ""}`;
}

/** Место строки сметы словами (без кода): строка по статьям — статья и подстатья, старая запись — «Прежняя таблица». */
export function budgetItemPath(row: {
  subarticle: { name: string; article: { templateArticle: { name: string } } } | null;
}): string {
  return row.subarticle ? `${row.subarticle.article.templateArticle.name} / ${row.subarticle.name}` : "Прежняя таблица";
}
