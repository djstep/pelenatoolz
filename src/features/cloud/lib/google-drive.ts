import { googleEndpoints } from "@/features/cloud/lib/endpoints";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";

export type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  /** Выданные права через пробел — человек мог снять галочку в окне согласия. */
  scope?: string;
  id_token?: string;
};

async function postGoogleToken(body: URLSearchParams) {
  try {
    return await fetch(googleEndpoints().token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new CloudApiError("GOOGLE_DRIVE", 0, "Google недоступен — попробуйте позже");
  }
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const res = await postGoogleToken(
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );
  if (!res.ok) {
    throw new CloudApiError("GOOGLE_DRIVE", res.status, "Google не выдал доступ — попробуйте подключить ещё раз");
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Обновление токена. `invalid_grant` — человек отозвал доступ в аккаунте Google,
 * сменил пароль или refresh-токен истёк (тестовый режим приложения — 7 дней):
 * лечится только переподключением.
 */
export async function refreshGoogleToken(refreshToken: string) {
  const res = await postGoogleToken(
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (data?.error === "invalid_grant" || res.status === 401) {
      throw new CloudReconnectRequiredError("GOOGLE_DRIVE", data?.error);
    }
    throw new CloudApiError("GOOGLE_DRIVE", res.status, "Не удалось обновить доступ к Google Диску — попробуйте позже");
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Отзыв доступа у Google. Отзыв любого токена снимает всё разрешение приложения в аккаунте —
 * поэтому при переподключении старый токен отзывается до окна согласия, а не после.
 * Не бросает: уже отозванный токен (400) — тоже успех.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(googleEndpoints().revoke, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

/**
 * Почта и id аккаунта из id_token. Подпись не проверяется: токен пришёл напрямую
 * от Google в ответ на обмен кода по HTTPS (так допускает документация OpenID Connect Google).
 */
export function parseGoogleIdToken(idToken: string | undefined): {
  sub: string | null;
  email: string | null;
} {
  const payload = idToken?.split(".")[1];
  if (!payload) return { sub: null, email: null };
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
      email?: unknown;
    };
    return {
      sub: typeof data.sub === "string" ? data.sub : null,
      email: typeof data.email === "string" ? data.email : null,
    };
  } catch {
    return { sub: null, email: null };
  }
}
