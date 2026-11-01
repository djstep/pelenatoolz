/**
 * Адреса Google и Яндекса для дисков. Вне production их можно подменить локальным
 * сервером-заглушкой (e2e, разработка): `CLOUD_STUB_GOOGLE_URL` / `CLOUD_STUB_YANDEX_URL` —
 * адрес заглушки без «/» в конце. В production переменные не читаются вовсе:
 * токены и файлы никогда не уйдут на подменённый адрес.
 */

export type GoogleEndpoints = {
  /** Окно согласия (браузер). */
  authorize: string;
  /** Обмен кода и обновление токена. */
  token: string;
  /** Отзыв токена. */
  revoke: string;
  /** Drive API v3: `${driveApi}/files`, `${driveApi}/files/{id}/permissions`. */
  driveApi: string;
  /** Загрузка содержимого: `${driveUpload}/files?uploadType=multipart`. */
  driveUpload: string;
};

export type YandexEndpoints = {
  /** Окно согласия (браузер). */
  authorize: string;
  /** Обмен кода и обновление токена. */
  token: string;
  /** Отзыв токена (`/revoke_token`). */
  revoke: string;
  /** Почта и id аккаунта (`/info`). */
  userInfo: string;
  /** REST API Диска v1: `${diskApi}/resources`, `${diskApi}/resources/upload`. */
  diskApi: string;
};

const GOOGLE_DEFAULTS: GoogleEndpoints = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  driveApi: "https://www.googleapis.com/drive/v3",
  driveUpload: "https://www.googleapis.com/upload/drive/v3",
};

const YANDEX_DEFAULTS: YandexEndpoints = {
  authorize: "https://oauth.yandex.ru/authorize",
  token: "https://oauth.yandex.ru/token",
  revoke: "https://oauth.yandex.ru/revoke_token",
  userInfo: "https://login.yandex.ru/info",
  diskApi: "https://cloud-api.yandex.net/v1/disk",
};

/** Адрес заглушки из переменной — только вне production; иначе null. */
function stubBase(envName: "CLOUD_STUB_GOOGLE_URL" | "CLOUD_STUB_YANDEX_URL") {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env[envName]?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function googleEndpoints(): GoogleEndpoints {
  const base = stubBase("CLOUD_STUB_GOOGLE_URL");
  if (!base) return GOOGLE_DEFAULTS;
  return {
    authorize: `${base}/o/oauth2/v2/auth`,
    token: `${base}/token`,
    revoke: `${base}/revoke`,
    driveApi: `${base}/drive/v3`,
    driveUpload: `${base}/upload/drive/v3`,
  };
}

export function yandexEndpoints(): YandexEndpoints {
  const base = stubBase("CLOUD_STUB_YANDEX_URL");
  if (!base) return YANDEX_DEFAULTS;
  return {
    authorize: `${base}/authorize`,
    token: `${base}/token`,
    revoke: `${base}/revoke_token`,
    userInfo: `${base}/info`,
    diskApi: `${base}/v1/disk`,
  };
}
