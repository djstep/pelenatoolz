import { COMMON_PASSWORDS } from "@/features/auth/lib/common-passwords";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Текст под пустым полем нового пароля. */
export const PASSWORD_RULES_HINT = `От ${PASSWORD_MIN_LENGTH} символов. Не почта и не частый пароль вроде qwertyuiop.`;

const ISSUE_TEXT = {
  tooShort: `Пароль слишком короткий: нужно от ${PASSWORD_MIN_LENGTH} символов`,
  tooLong: `Пароль слишком длинный: не больше ${PASSWORD_MAX_LENGTH} символов`,
  common: "Этот пароль слишком распространён, придумайте другой",
  sameAsEmail: "Пароль не должен совпадать с почтой",
} as const;

export type PasswordIssue = keyof typeof ISSUE_TEXT;

/**
 * Единственное место с правилами нового пароля: регистрация, смена, сброс и подсказка на форме.
 * Вход существующим паролем эта проверка не проходит: старые пароли продолжают работать.
 * Возвращает текст ошибки или null, если пароль подходит. Без `email` проверки почты нет.
 */
export function passwordProblem(password: string, email?: string | null): string | null {
  const issue = findPasswordIssue(password, email);
  return issue ? ISSUE_TEXT[issue] : null;
}

function findPasswordIssue(password: string, email?: string | null): PasswordIssue | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "tooShort";
  if (password.length > PASSWORD_MAX_LENGTH) return "tooLong";
  const normalized = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(normalized)) return "common";
  const mail = email?.trim().toLowerCase();
  if (mail && (normalized === mail || normalized === mail.split("@")[0])) return "sameAsEmail";
  return null;
}
