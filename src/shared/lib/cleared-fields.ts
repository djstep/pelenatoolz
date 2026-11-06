type Cleared<T, K extends keyof T> = Omit<T, K> & { [P in K]: Exclude<T[P], undefined> | null | undefined };

/** Значение для снимка: undefined — поля не было в форме, остаётся текущее; null — очищено. */
export function orCurrent<V>(value: V | undefined, current: V): V {
  return value === undefined ? current : value;
}

/**
 * Снимок и основная запись (актёр, локация) живут отдельно: основную могли изменить в другой
 * форме. В неё пишем только то, что человек поменял в снимке, иначе вернём устаревшее значение.
 */
export function changedFrom<V>(value: V | null | undefined, current: V | null | undefined) {
  return value !== undefined && (value ?? null) !== (current ?? null);
}

/**
 * Разбор формы даёт undefined и на пустое поле, и на поле, которого в форме нет, а база
 * понимает undefined как «не менять»: стёртое значение возвращалось. Здесь поле, которое
 * пришло пустым, становится null («очистить»); поля, которого в форме не было, не трогаем.
 * fields — только столбцы, где пусто допустимо. Если поле закрыто правом (финансы),
 * его нужно отсеять здесь или после: форма могла прислать его пустым.
 */
export function clearEmptied<T extends object, K extends keyof T & string>(
  data: T,
  formData: FormData,
  fields: readonly K[],
): Cleared<T, K> {
  const result = { ...data } as Record<string, unknown>;
  for (const field of fields) {
    const raw = formData.get(field);
    if (typeof raw === "string" && raw.trim() === "") result[field] = null;
  }
  return result as Cleared<T, K>;
}
