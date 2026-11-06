/**
 * Кто может зарегистрироваться и создавать проекты. Без `REGISTRATION_ALLOWLIST` список пуст:
 * регистрация открыта только по приглашению, создавать проекты не может никто.
 * Адреса в переменной разделяются запятой, точкой с запятой или пробелом, регистр не важен.
 */
export const REGISTRATION_CLOSED_MESSAGE =
  "Регистрация закрыта. Попросите приглашение у владельца проекта и зарегистрируйтесь по ссылке из него.";

export const PROJECT_CREATION_CLOSED_MESSAGE =
  "Создавать проекты могут только адреса из списка владельца сервиса.";

/** Ссылка приглашения: `nanoid(32)`. Всё остальное токеном не считается. */
const INVITE_CALLBACK = /^\/(?:ru|en)\/invite\/([A-Za-z0-9_-]{32})$/;

export function parseAllowlist(raw: string | undefined): Set<string> {
  const addresses = (raw ?? "")
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.includes("@"));
  return new Set(addresses);
}

export function isAllowlisted(
  email: string | null | undefined,
  raw: string | undefined = process.env.REGISTRATION_ALLOWLIST,
): boolean {
  if (!email) return false;
  return parseAllowlist(raw).has(email.trim().toLowerCase());
}

/** Токен из адреса возврата. Сам адрес приходит из браузера, поэтому формат проверяется строго. */
export function inviteTokenFromCallback(callbackUrl: unknown): string | null {
  if (typeof callbackUrl !== "string") return null;
  return INVITE_CALLBACK.exec(callbackUrl)?.[1] ?? null;
}

export type InviteForRegistration = {
  email: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

/** Приглашение ещё можно принять. */
export function isInviteActive(
  invite: InviteForRegistration | null | undefined,
  now: Date = new Date(),
): invite is InviteForRegistration {
  return Boolean(invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt >= now);
}

/** Приглашение открывает регистрацию этой почте. Именное приглашение — только своей. */
export function inviteAllowsRegistration(
  invite: InviteForRegistration | null | undefined,
  email: string,
  now: Date = new Date(),
): boolean {
  if (!isInviteActive(invite, now)) return false;
  return !invite.email || invite.email.toLowerCase() === email.trim().toLowerCase();
}
