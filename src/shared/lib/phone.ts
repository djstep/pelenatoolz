import { z } from "zod";

const PHONE_CHARS = /^\+?[\d\s()-]+$/;

export const PHONE_HINT = "цифры, пробелы, скобки, дефис и «+» в начале; 5–15 цифр";

/** Телефон: «+7 (999) 123-45-67», «8 999 1234567». Пустая строка — нет телефона. */
export function isValidPhone(value: string): boolean {
  if (!PHONE_CHARS.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 5 && digits <= 15;
}

/** Необязательный телефон для форм: пусто → null, иначе проверка формата. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30, "Телефон слишком длинный")
  .refine((v) => v === "" || isValidPhone(v), `Телефон: ${PHONE_HINT}`)
  .transform((v) => (v === "" ? null : v));
