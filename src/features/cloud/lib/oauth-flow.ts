import "server-only";

import type { CloudProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  revokeBeforeReconnect,
  saveCloudConnection,
} from "@/features/cloud/lib/cloud-service";
import { googleEndpoints, yandexEndpoints } from "@/features/cloud/lib/endpoints";
import {
  exchangeGoogleCode,
  parseGoogleIdToken,
  revokeGoogleToken,
} from "@/features/cloud/lib/google-drive";
import {
  cloudConnectRefusal,
  cloudConnectRefusalText,
} from "@/features/cloud/lib/oauth-access";
import {
  GOOGLE_REQUESTED_SCOPE,
  hasRequiredScope,
  YANDEX_APP_FOLDER_SCOPE,
} from "@/features/cloud/lib/scopes";
import {
  appOrigin,
  signOAuthState,
  verifyOAuthState,
  type CloudConnectPurpose,
} from "@/features/cloud/lib/token-crypto";
import {
  exchangeYandexCode,
  fetchYandexAccount,
  yandexDeviceId,
} from "@/features/cloud/lib/yandex-disk";
import { getProjectForUser } from "@/features/projects/queries";
import { safeRedirectPath } from "@/shared/lib/safe-redirect";

const DEFAULT_RETURN = "/ru/profile";

const PROVIDER_SLUG: Record<CloudProvider, "google" | "yandex"> = {
  GOOGLE_DRIVE: "google",
  YANDEX_DISK: "yandex",
};

/** Ошибки подключения в адресе возврата (`?cloud_error=`) — тексты в `oauthNoticeText`. */
export type CloudOAuthErrorCode =
  | "google"
  | "yandex"
  | "state"
  | "token"
  | "scope"
  | "forbidden"
  | "unsupported"
  | "config_google"
  | "config_yandex"
  | "bad_request";

function callbackUri(provider: CloudProvider) {
  return `${appOrigin()}/api/cloud/${PROVIDER_SLUG[provider]}/callback`;
}

/** Добавить параметр к адресу возврата (в нём уже может быть `?`). */
function withParam(path: string, key: string, value: string, origin = appOrigin()) {
  const url = new URL(path, origin);
  url.searchParams.set(key, value);
  return url.toString();
}

async function connectRefusal(
  userId: string,
  purpose: CloudConnectPurpose,
  projectId: string | null,
) {
  const project = projectId ? await getProjectForUser(projectId, userId) : null;
  return cloudConnectRefusal({
    purpose,
    projectId,
    userId,
    project: project
      ? { ownerUserId: project.ownerUserId, role: project.memberships[0]?.role ?? null }
      : null,
  });
}

/**
 * Начало подключения — только POST из формы на нашем сайте: с чужого сайта запрос
 * придёт без cookie сессии (SameSite=Lax), а Origin не совпадёт. Это важно, потому что
 * переподключение сразу отзывает старый токен.
 */
export async function startCloudConnect(request: Request, provider: CloudProvider) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.redirect(new URL("/ru/login", appOrigin()), 303);
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== new URL(appOrigin()).origin) {
    return NextResponse.json({ error: "Запрос не с этого сайта" }, { status: 403 });
  }

  // Ошибки — возвратом на страницу, откуда начали, с плашкой (`?cloud_error=`), а не голым JSON.
  // Исключения: чужой сайт (выше) и чужой проект (ниже) — туда возвращать некуда.
  // Возврат — на тот же сайт, откуда пришёл запрос (Origin уже проверен выше).
  const back = (path: string, code: CloudOAuthErrorCode) =>
    NextResponse.redirect(withParam(path, "cloud_error", code, new URL(request.url).origin), 303);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(DEFAULT_RETURN, "bad_request");
  }
  const purpose: CloudConnectPurpose = form.get("purpose") === "project" ? "project" : "personal";
  const projectIdRaw = form.get("projectId");
  const projectId = typeof projectIdRaw === "string" && projectIdRaw ? projectIdRaw : null;
  const returnTo = safeRedirectPath(form.get("returnTo"), DEFAULT_RETURN);

  const refusal = await connectRefusal(userId, purpose, projectId);
  if (refusal === "not_member") {
    return NextResponse.json({ error: cloudConnectRefusalText[refusal] }, { status: 403 });
  }
  if (refusal) return back(returnTo, "forbidden");
  // Хранение токенов диска проекта — шаг 4 (ProjectDrive). До него — только личные диски.
  if (purpose === "project") return back(returnTo, "unsupported");

  const clientId =
    provider === "GOOGLE_DRIVE" ? process.env.GOOGLE_CLIENT_ID : process.env.YANDEX_CLIENT_ID;
  const clientSecret =
    provider === "GOOGLE_DRIVE" ? process.env.GOOGLE_CLIENT_SECRET : process.env.YANDEX_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) {
    console.error(`[cloud ${PROVIDER_SLUG[provider]} authorize] не задан client id / secret`);
    return back(returnTo, provider === "GOOGLE_DRIVE" ? "config_google" : "config_yandex");
  }

  await revokeBeforeReconnect(userId, provider);

  const state = signOAuthState({ userId, purpose, projectId, provider, returnTo });

  if (provider === "GOOGLE_DRIVE") {
    // Без include_granted_scopes: у приложения в аккаунте остаётся только drive.file.
    const url = new URL(googleEndpoints().authorize);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUri(provider));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_REQUESTED_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return NextResponse.redirect(url, 303);
  }

  const url = new URL(yandexEndpoints().authorize);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callbackUri(provider));
  url.searchParams.set("scope", YANDEX_APP_FOLDER_SCOPE);
  url.searchParams.set("device_id", yandexDeviceId(userId));
  url.searchParams.set("device_name", "PELENA");
  url.searchParams.set("force_confirm", "yes");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url, 303);
}

/** Ответ Google / Яндекса после окна согласия. */
export async function finishCloudConnect(request: Request, provider: CloudProvider) {
  const slug = PROVIDER_SLUG[provider];
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const fail = (path: string, code: CloudOAuthErrorCode) =>
    NextResponse.redirect(withParam(path, "cloud_error", code));

  if (!stateRaw) return fail(DEFAULT_RETURN, slug);
  const state = verifyOAuthState(stateRaw);
  if (!state || state.provider !== provider) return fail(DEFAULT_RETURN, "state");

  // Диск привязывается только к тому, кто сейчас вошёл и сам начал подключение.
  const session = await auth();
  if (!session?.user?.id || session.user.id !== state.userId) {
    return fail(DEFAULT_RETURN, "state");
  }

  const returnTo = safeRedirectPath(state.returnTo, DEFAULT_RETURN);
  if (searchParams.get("error") || !code) return fail(returnTo, slug);

  const refusal = await connectRefusal(state.userId, state.purpose, state.projectId);
  if (refusal) return fail(returnTo, "forbidden");
  if (state.purpose === "project") return fail(returnTo, "unsupported");

  try {
    if (provider === "GOOGLE_DRIVE") {
      const tokens = await exchangeGoogleCode(code, callbackUri(provider));
      const scopes = tokens.scope ?? "";
      // Человек снял галочку «файлы, созданные приложением» — такой токен не годится.
      if (!hasRequiredScope(provider, scopes)) {
        await revokeGoogleToken(tokens.refresh_token ?? tokens.access_token);
        return fail(returnTo, "scope");
      }
      const account = parseGoogleIdToken(tokens.id_token);
      await saveCloudConnection({
        userId: state.userId,
        provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresIn: tokens.expires_in ?? null,
        scopes,
        accountEmail: account.email,
        accountSubject: account.sub,
      });
    } else {
      const tokens = await exchangeYandexCode(code);
      const account = await fetchYandexAccount(tokens.access_token);
      await saveCloudConnection({
        userId: state.userId,
        provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresIn: tokens.expires_in ?? null,
        // Яндекс выдаёт ровно права, запрошенные в окне (и отмеченные в приложении).
        scopes: tokens.scope ?? YANDEX_APP_FOLDER_SCOPE,
        accountEmail: account.email,
        accountSubject: account.id,
      });
    }
  } catch (e) {
    console.error(`[cloud ${slug} callback]`, e instanceof Error ? e.message : e);
    return fail(returnTo, "token");
  }

  return NextResponse.redirect(withParam(returnTo, "cloud_connected", slug));
}
