/**
 * Явный список полей строки, которые сервер отдаёт в браузер (или принимает из формы):
 * `open` — всем, кто видит строку; `finance` — только с фин. правом источника строки
 * (актёр, объект, категория ресурса, `finance:read`). Поле, которого нет ни в одном списке,
 * не уходит никогда — новая колонка в базе сама в браузер не попадёт.
 */
export type FieldAllowlist<O extends PropertyKey, F extends PropertyKey> = {
  readonly open: readonly O[];
  readonly finance: readonly F[];
};

/** Что экран делает с фин. полями источника: правит, только показывает или их нет. */
export type FinanceAccess = "edit" | "view" | "none";

export function financeAccess(canRead: boolean, canWrite: boolean): FinanceAccess {
  if (canWrite) return "edit";
  return canRead ? "view" : "none";
}

/**
 * Копия строки только с разрешёнными полями. Без фин. права фин. полей в результате нет
 * совсем (не `null`), так что их не видно ни в props, ни в RSC, ни в JSON. Один список
 * можно применять к разным выборкам одной сущности: поля, которых в строке нет, пропускаются.
 */
export function pickFinanceFields<
  T extends object,
  O extends PropertyKey,
  F extends PropertyKey,
>(
  row: T,
  fields: FieldAllowlist<O, F>,
  canFinance: boolean,
): Pick<T, Extract<O, keyof T>> & Partial<Pick<T, Extract<F, keyof T>>> {
  const result: Record<PropertyKey, unknown> = {};
  const keys: readonly PropertyKey[] = canFinance
    ? [...fields.open, ...fields.finance]
    : fields.open;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      result[key] = (row as Record<PropertyKey, unknown>)[key];
    }
  }
  return result as Pick<T, Extract<O, keyof T>> & Partial<Pick<T, Extract<F, keyof T>>>;
}

/** Prisma `select` из явного списка полей: `{ id: true, name: true, … }`. */
export function selectFields<K extends string>(keys: readonly K[]): { readonly [P in K]: true } {
  return Object.fromEntries(keys.map((key) => [key, true])) as { readonly [P in K]: true };
}
