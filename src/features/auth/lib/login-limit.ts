import { createHash } from "node:crypto";

/** Вход: 5 неудач за 15 минут на пару «почта + IP», затем блок на 15 минут. */
export const LOGIN_RATE_LIMIT = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

/**
 * Вход по одной почте с любых IP: 20 неудач за час, затем блок почты на 15 минут.
 * Против подбора с множества адресов, где счётчик пары не срабатывает.
 */
export const LOGIN_EMAIL_RATE_LIMIT = {
  limit: 20,
  windowMs: 60 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

export const LOGIN_BLOCKED_MESSAGE = "Слишком много попыток входа. Попробуйте позже.";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Начало ключа всех счётчиков одной почты: скрипт владельца снимает блок сразу со всех IP и общий. */
export function loginLimitEmailPrefix(email: string): string {
  return `login:${sha256(email.trim().toLowerCase())}:`;
}

/** Ключ счётчика: почта и IP только в виде хешей, в базе их открытого вида нет. */
export function loginLimitKey(email: string, ip: string): string {
  return `${loginLimitEmailPrefix(email)}${sha256(ip)}`;
}

/** Ключ счётчика почты с любых IP. Хеши IP шестнадцатеричные, поэтому с ними он не совпадёт. */
export function loginLimitEmailKey(email: string): string {
  return `${loginLimitEmailPrefix(email)}all`;
}

/**
 * IP посетителя. Берём последний адрес из x-forwarded-for: его дописал ближайший к нам прокси
 * (Vercel, на VPS — nginx), а всё левее мог подставить сам посетитель.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
