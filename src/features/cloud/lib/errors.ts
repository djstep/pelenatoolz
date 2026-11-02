import type { CloudProvider } from "@prisma/client";

/**
 * Доступ к диску отозван или истёк насовсем: Google `invalid_grant` при обновлении токена,
 * 401 на запрос с токеном, Яндекс 400/401 при обновлении. Лечится только переподключением.
 * Код выше по цепочке помечает подключение «нужно переподключить» и не падает.
 */
export class CloudReconnectRequiredError extends Error {
  readonly provider: CloudProvider;

  constructor(provider: CloudProvider, detail?: string) {
    super(
      provider === "GOOGLE_DRIVE"
        ? "Доступ к Google Диску отозван или истёк — переподключите диск"
        : "Доступ к Яндекс Диску отозван или истёк — переподключите диск",
    );
    this.name = "CloudReconnectRequiredError";
    this.provider = provider;
    if (detail) this.cause = detail;
  }
}

export function isCloudReconnectRequiredError(e: unknown): e is CloudReconnectRequiredError {
  return e instanceof CloudReconnectRequiredError;
}

/**
 * Любая другая ошибка Google / Яндекса: `message` — понятный текст для человека,
 * `status` — HTTP-код ответа (0 — сеть недоступна), `reason` — код причины провайдера
 * (`notFound`, `sharingRateLimitExceeded`, `DiskPathDoesntExistsError` …), если есть.
 * Текст ответа провайдера в `message` не попадает: там могут быть почты.
 */
export class CloudApiError extends Error {
  readonly provider: CloudProvider;
  readonly status: number;
  readonly reason: string | null;

  constructor(provider: CloudProvider, status: number, message: string, reason?: string | null) {
    super(message);
    this.name = "CloudApiError";
    this.provider = provider;
    this.status = status;
    this.reason = reason ?? null;
  }
}

export function isCloudApiError(e: unknown): e is CloudApiError {
  return e instanceof CloudApiError;
}
