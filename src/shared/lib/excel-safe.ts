/** Всегда может стать формулой: «=», «@», табуляция или CR в начале (пункт 26 аудита). */
const ALWAYS_FORMULA_START = /^[=@\t\r]/;
/** Знак в начале: «+», «-» или минус «−». */
const SIGN_START = /^[+\-\u2212]/;
/** После знака — только цифры, пробел, ( ) - . , ° + / — телефон, температура, число. */
const SAFE_AFTER_SIGN = /^[0-9 ()\-.,°+/]*$/;

/**
 * Похожа ли строка на формулу Excel: начинается с «=», «@», табуляции или CR — да; со знака
 * «+» / «-» / «−» — да, если дальше есть что-то кроме цифр, пробелов, скобок, «-», «.», «,»,
 * «°», «+», «/». Так «+7 921 555-01-01» и «+6°» остаются как есть, а «+cmd|…» — нет.
 */
export function isFormulaLike(value: string): boolean {
  if (ALWAYS_FORMULA_START.test(value)) return true;
  if (SIGN_START.test(value)) return !SAFE_AFTER_SIGN.test(value.slice(1));
  return false;
}

/**
 * Значение ячейки для выгрузки в Excel: строка, похожая на формулу (`isFormulaLike`), получает
 * апостроф впереди. Пишется текстовой ячейкой, как и раньше. Числа, даты и пустые значения
 * не трогаются — отрицательная сумма остаётся числом.
 */
export function excelSafe<T>(value: T): T | string {
  return typeof value === "string" && isFormulaLike(value) ? `'${value}` : value;
}
