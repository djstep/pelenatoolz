/**
 * Редакция политики обработки персональных данных, которую принимает пользователь: дата публикации.
 * Сохраняется в `User.personalDataConsentVersion`. При новой редакции значение меняется, и каждый
 * пользователь один раз принимает её при следующем входе.
 */
export const PERSONAL_DATA_POLICY_VERSION = "2026-11-07";

export const PERSONAL_DATA_CONSENT_REQUIRED = "Нужно согласие на обработку персональных данных";

/** Принята не эта редакция или не принята никакая: нужно согласие. */
export function needsPersonalDataConsent(acceptedVersion: string | null | undefined) {
  return acceptedVersion !== PERSONAL_DATA_POLICY_VERSION;
}
