import type { CloudProvider } from "@prisma/client";

/** Аккаунт у провайдера, которому принадлежат токены подключения (личного или диска проекта). */
export type ProviderAccount = {
  provider: CloudProvider;
  accountSubject: string | null;
  accountEmail: string | null;
};

/**
 * Снимает ли отзыв токена доступ у других подключений того же аккаунта.
 * - Google: отзыв любого токена снимает разрешение приложения во всём аккаунте — ломаются
 *   все подключения этого аккаунта (личные у других людей, диск проекта).
 * - Яндекс: `revoke_token` отзывает токен одного устройства (`device_id`), а устройство у нас
 *   своё у каждого пользователя — другие подключения того же аккаунта не задеваются.
 */
export function revokeIsAccountWide(provider: CloudProvider): boolean {
  return provider === "GOOGLE_DRIVE";
}

function normalizeEmail(email: string | null) {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

/** Тот же аккаунт: по id у провайдера; у старых подключений без id — по почте. */
export function sameProviderAccount(a: ProviderAccount, b: ProviderAccount): boolean {
  if (a.provider !== b.provider) return false;
  if (a.accountSubject && b.accountSubject) return a.accountSubject === b.accountSubject;
  const email = normalizeEmail(a.accountEmail);
  return email !== null && email === normalizeEmail(b.accountEmail);
}

/**
 * Отзывать ли токены у провайдера при отключении, замене, переподключении.
 * `otherActive` — другие активные подключения (любого пользователя / проекта), без отключаемого.
 * Есть активное подключение того же аккаунта и отзыв общий — только удалить у себя.
 * Аккаунт неизвестен (ни id, ни почты) — отзываем, как раньше: сверить не с чем.
 */
export function shouldRevokeAtProvider(
  target: ProviderAccount,
  otherActive: readonly ProviderAccount[],
): boolean {
  if (!revokeIsAccountWide(target.provider)) return true;
  return !otherActive.some((other) => sameProviderAccount(target, other));
}
