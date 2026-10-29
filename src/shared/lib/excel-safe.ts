/** Начало строки, которое Excel может принять за формулу (пункт 26 аудита). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Значение ячейки для выгрузки в Excel: строка, начинающаяся со знака формулы, получает
 * апостроф впереди. Числа, даты и пустые значения не трогаются — отрицательная сумма
 * остаётся числом.
 */
export function excelSafe<T>(value: T): T | string {
  return typeof value === "string" && FORMULA_START.test(value) ? `'${value}` : value;
}
