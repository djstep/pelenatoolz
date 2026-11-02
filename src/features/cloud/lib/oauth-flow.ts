import "server-only";

import type { CloudProvider } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  canRevokeAtProvider,
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
  getProjectDriveState,
  revokeProjectDriveTokens,
  saveProjectDrive,
} from "@/features/cloud/lib/project-drive-service";
import {
  connectionReconnectReason,
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
  revokeYandexToken,
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
  | "scope_yandex"
  | "forbidden"
  | "not_keeper"
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
  const membership = project?.memberships[0] ?? null;
  const drive = project && purpose === "project" ? await getProjectDriveState(project.id) : null;
  return cloudConnectRefusal({
    purpose,
    projectId,
    userId,
    project:
      project && membership
        ? {
            ownerUserId: project.ownerUserId,
            role: membership.role,
            membershipId: membership.id,
            drive,
          }
        : null,
  });
}

/** Отказ в подключении → код ошибки в адресе возврата. */
function refusalCode(refusal: string): CloudOAuthErrorCode {
  return refusal === "not_keeper" ? "not_keeper" : "forbidden";
}

/**
 * Отозвать только что выданный токен, который не годится (не те права, отказ под блокировкой),
 * — если этот аккаунт больше нигде в системе не подключён (Google отзывает весь аккаунт).
 */
async function revokeFreshToken(
  provider: CloudProvider,
  token: string,
  account: { accountSubject: string | null; accountEmail: string | null },
) {
  if (!(await canRevokeAtProvider({ provider, ...account }))) return;
  if (provider === "GOOGLE_DRIVE") await revokeGoogleToken(token);
  else await revokeYandexToken(token);
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
  if (refusal) return back(returnTo, refusalCode(refusal));
  // Диск проекта — только Google: на Яндексе нельзя выдать доступ конкретным людям.
  if (purpose === "project" && provider !== "GOOGLE_DRIVE") return back(returnTo, "unsupported");

  const clientId =
    provider === "GOOGLE_DRIVE" ? process.env.GOOGLE_CLIENT_ID : process.env.YANDEX_CLIENT_ID;
  const clientSecret =
    provider === "GOOGLE_DRIVE" ? process.env.GOOGLE_CLIENT_SECRET : process.env.YANDEX_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) {
    console.error(`[cloud ${PROVIDER_SLUG[provider]} authorize] не задан client id / secret`);
    return back(returnTo, provider === "GOOGLE_DRIVE" ? "config_google" : "config_yandex");
  }

  // Личный диск: старый токен отзывается до окна согласия. Диск проекта работает до возврата
  // из окна, прежние токены отзываются после сохранения нового (saveProjectDrive).
  if (purpose === "personal") await revokeBeforeReconnect(userId, provider);

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
  if (refusal) return fail(returnTo, refusalCode(refusal));
  if (state.purpose === "project") {
    if (provider !== "GOOGLE_DRIVE" || !state.projectId) return fail(returnTo, "unsupported");
    return finishProjectDriveConnect(code, state.userId, state.projectId, returnTo);
  }

  let saved: Awaited<ReturnType<typeof saveCloudConnection>>;
  try {
    if (provider === "GOOGLE_DRIVE") {
      const tokens = await exchangeGoogleCode(code, callbackUri(provider));
      logTokenResponse(slug, tokens);
      const scopes = tokens.scope ?? "";
      const account = parseGoogleIdToken(tokens.id_token);
      // Человек снял галочку «файлы, созданные приложением» — такой токен не годится.
      if (!hasRequiredScope(provider, scopes)) {
        await revokeFreshToken(provider, tokens.refresh_token ?? tokens.access_token, {
          accountSubject: account.sub,
          accountEmail: account.email,
        });
        return fail(returnTo, "scope");
      }
      saved = await saveCloudConnection({
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
      logTokenResponse(slug, tokens);
      // Яндекс обычно не присылает scope: права — ровно запрошенные в окне (и отмеченные
      // в приложении). Если прислал и в нём нет папки приложения — такой токен не годится.
      const scopes = tokens.scope?.trim() ? tokens.scope : YANDEX_APP_FOLDER_SCOPE;
      if (!hasRequiredScope(provider, scopes)) {
        // У Яндекса отзыв — только токен этого устройства, других подключений не задевает.
        await revokeYandexToken(tokens.access_token);
        return fail(returnTo, "scope_yandex");
      }
      const account = await fetchYandexAccount(tokens.access_token);
      saved = await saveCloudConnection({
        userId: state.userId,
        provider,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresIn: tokens.expires_in ?? null,
        scopes,
        accountEmail: account.email,
        accountSubject: account.id,
      });
    }
  } catch (e) {
    console.error(`[cloud ${slug} callback]`, e instanceof Error ? e.message : e);
    return fail(returnTo, "token");
  }

  // «Подключён» — только если запись сохранилась рабочей (права есть, не помечена отозванной).
  if (connectionReconnectReason(saved)) {
    console.error(`[cloud ${slug} callback] подключение сохранено, но не годится для записи`);
    return fail(returnTo, provider === "GOOGLE_DRIVE" ? "scope" : "scope_yandex");
  }
  return NextResponse.redirect(withParam(returnTo, "cloud_connected", slug));
}

/**
 * Диск проекта (только Google) после окна согласия. Право подключать уже проверено по `state`;
 * `saveProjectDrive` проверяет его ещё раз под блокировкой проекта перед записью.
 */
async function finishProjectDriveConnect(
  code: string,
  userId: string,
  projectId: string,
  returnTo: string,
) {
  const provider = "GOOGLE_DRIVE" as const;
  const fail = (code: CloudOAuthErrorCode) =>
    NextResponse.redirect(withParam(returnTo, "cloud_error", code));

  let saved: Awaited<ReturnType<typeof saveProjectDrive>>;
  let freshToken: string;
  let account: ReturnType<typeof parseGoogleIdToken>;
  try {
    const tokens = await exchangeGoogleCode(code, callbackUri(provider));
    logTokenResponse("google project", tokens);
    const scopes = tokens.scope ?? "";
    freshToken = tokens.refresh_token ?? tokens.access_token;
    account = parseGoogleIdToken(tokens.id_token);
    if (!hasRequiredScope(provider, scopes)) {
      await revokeFreshToken(provider, freshToken, {
        accountSubject: account.sub,
        accountEmail: account.email,
      });
      return fail("scope");
    }
    saved = await saveProjectDrive({
      projectId,
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresIn: tokens.expires_in ?? null,
      scopes,
      accountEmail: account.email,
      accountSubject: account.sub,
    });
  } catch (e) {
    console.error("[cloud google project callback]", e instanceof Error ? e.message : e);
    return fail("token");
  }

  if ("error" in saved) {
    // Пока человек был в окне Google, его удалили / понизили или диск подключил другой.
    await revokeFreshToken(provider, freshToken, {
      accountSubject: account.sub,
      accountEmail: account.email,
    });
    return fail(refusalCode(saved.error));
  }
  // Прежние токены заменённого диска — после записи, с правилом «аккаунт ещё подключён — не отзывать».
  await revokeProjectDriveTokens(saved.released);
  return NextResponse.redirect(withParam(returnTo, "cloud_connected", "project"));
}

/**
 * В лог сервера — какие поля прислал провайдер при обмене кода и выданные права.
 * Значения токенов не пишутся никогда.
 */
function logTokenResponse(slug: string, tokens: object) {
  const fields = Object.keys(tokens).sort().join(", ");
  const scope = (tokens as { scope?: unknown }).scope;
  console.info(
    `[cloud ${slug} callback] ответ на обмен кода: поля ${fields}; scope: ${
      typeof scope === "string" ? scope || "(пусто)" : "(нет)"
    }`,
  );
}
