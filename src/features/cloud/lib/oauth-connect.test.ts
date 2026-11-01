import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeModule from "node:module";
import path from "node:path";
import { afterEach, before, describe, test } from "node:test";
import { linkSiteLabel, parseCloudLink, safeExternalHref } from "@/features/cloud/lib/cloud-link";
import { isCloudApiError, isCloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import {
  parseGoogleIdToken,
  refreshGoogleToken,
  revokeGoogleToken,
} from "@/features/cloud/lib/google-drive";
import { cloudOAuthNotice } from "@/features/cloud/lib/oauth-notice";
import {
  connectionReconnectReason,
  GOOGLE_REQUESTED_SCOPE,
  hasRequiredScope,
} from "@/features/cloud/lib/scopes";
import { signOAuthState, verifyOAuthState } from "@/features/cloud/lib/token-crypto";
import { refreshYandexToken, yandexDeviceId } from "@/features/cloud/lib/yandex-disk";

// oauth-access.ts → role-rules.ts — серверный модуль ("server-only"):
// берём его с условием react-server, как в awaiting-approval.test.ts.
type ResolveContext = { conditions: string[] };
type RegisterHooks = (hooks: {
  resolve: (
    specifier: string,
    context: ResolveContext,
    nextResolve: (specifier: string, context: ResolveContext) => unknown,
  ) => unknown;
}) => void;
(nodeModule as unknown as { registerHooks: RegisterHooks }).registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve(specifier, {
        ...context,
        conditions: [...context.conditions, "react-server"],
      });
    }
    return nextResolve(specifier, context);
  },
});

let cloudConnectRefusal: typeof import("@/features/cloud/lib/oauth-access").cloudConnectRefusal;
before(async () => {
  ({ cloudConnectRefusal } = await import("@/features/cloud/lib/oauth-access"));
});

const realFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CLOUD_STUB_GOOGLE_URL;
});

describe("права подключения → «переподключите»", () => {
  test("новые права Google — без drive.readonly и profile", () => {
    assert.deepEqual(GOOGLE_REQUESTED_SCOPE.split(" "), [
      "https://www.googleapis.com/auth/drive.file",
      "openid",
      "email",
    ]);
  });

  test("старое подключение без scopes или с drive.readonly / disk.read", () => {
    const base = { needsReconnectAt: null };
    assert.equal(connectionReconnectReason({ ...base, provider: "GOOGLE_DRIVE", scopes: null }), "old_scopes");
    assert.equal(
      connectionReconnectReason({
        ...base,
        provider: "GOOGLE_DRIVE",
        scopes: "https://www.googleapis.com/auth/drive.readonly email profile",
      }),
      "old_scopes",
    );
    assert.equal(
      connectionReconnectReason({ ...base, provider: "YANDEX_DISK", scopes: "cloud_api:disk.read" }),
      "old_scopes",
    );
  });

  test("новые права — подключение годится; отозванное — «revoked» даже с правами", () => {
    const google = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file";
    assert.equal(connectionReconnectReason({ provider: "GOOGLE_DRIVE", scopes: google, needsReconnectAt: null }), null);
    assert.equal(
      connectionReconnectReason({ provider: "YANDEX_DISK", scopes: "cloud_api:disk.app_folder", needsReconnectAt: null }),
      null,
    );
    assert.equal(
      connectionReconnectReason({ provider: "GOOGLE_DRIVE", scopes: google, needsReconnectAt: new Date() }),
      "revoked",
    );
  });

  test("галочку drive.file сняли в окне согласия", () => {
    assert.equal(hasRequiredScope("GOOGLE_DRIVE", "openid https://www.googleapis.com/auth/userinfo.email"), false);
  });
});

describe("state OAuth с назначением", () => {
  test("personal и project проходят проверку подписи", () => {
    const personal = verifyOAuthState(
      signOAuthState({ userId: "u1", purpose: "personal", projectId: null, provider: "GOOGLE_DRIVE", returnTo: "/ru/profile" }),
    );
    assert.equal(personal?.purpose, "personal");
    assert.equal(personal?.projectId, null);
    const project = verifyOAuthState(
      signOAuthState({ userId: "u1", purpose: "project", projectId: "p1", provider: "YANDEX_DISK", returnTo: "/ru/projects/p1" }),
    );
    assert.equal(project?.purpose, "project");
    assert.equal(project?.projectId, "p1");
  });

  test("project без проекта и подделанный state — отказ", () => {
    assert.equal(
      verifyOAuthState(
        signOAuthState({ userId: "u1", purpose: "project", projectId: null, provider: "GOOGLE_DRIVE", returnTo: "/" }),
      ),
      null,
    );
    const good = signOAuthState({ userId: "u1", purpose: "personal", projectId: null, provider: "GOOGLE_DRIVE", returnTo: "/" });
    const [data, sig] = good.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(data, "base64url").toString("utf8")), userId: "u2" }),
    ).toString("base64url");
    assert.equal(verifyOAuthState(`${forged}.${sig}`), null);
  });
});

describe("кто может подключить", () => {
  const producer = { isSystem: true, name: "Продюсер" };
  const director = { isSystem: true, name: "Режиссёр" };

  test("личный диск без проекта — любой вошедший", () => {
    assert.equal(cloudConnectRefusal({ purpose: "personal", projectId: null, userId: "u1", project: null }), null);
  });

  test("личный диск с чужим проектом — отказ", () => {
    assert.equal(
      cloudConnectRefusal({ purpose: "personal", projectId: "p1", userId: "u1", project: null }),
      "not_member",
    );
  });

  test("диск проекта — владелец или продюсер", () => {
    assert.equal(
      cloudConnectRefusal({ purpose: "project", projectId: "p1", userId: "u1", project: { ownerUserId: "u1", role: director } }),
      null,
    );
    assert.equal(
      cloudConnectRefusal({ purpose: "project", projectId: "p1", userId: "u1", project: { ownerUserId: "u9", role: producer } }),
      null,
    );
    assert.equal(
      cloudConnectRefusal({ purpose: "project", projectId: "p1", userId: "u1", project: { ownerUserId: "u9", role: director } }),
      "not_producer",
    );
    // Обычная роль с именем «Продюсер» — не продюсер (имя системной роли занято, но проверка — по isSystem).
    assert.equal(
      cloudConnectRefusal({
        purpose: "project",
        projectId: "p1",
        userId: "u1",
        project: { ownerUserId: "u9", role: { isSystem: false, name: "Продюсер" } },
      }),
      "not_producer",
    );
    assert.equal(cloudConnectRefusal({ purpose: "project", projectId: null, userId: "u1", project: null }), "no_project");
  });
});

describe("обновление и отзыв токена", () => {
  test("Google invalid_grant — нужно переподключить", async () => {
    mockFetch(() => json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }));
    await assert.rejects(refreshGoogleToken("r"), (e) => isCloudReconnectRequiredError(e) && e.provider === "GOOGLE_DRIVE");
  });

  test("Google 500 — обычная ошибка, не переподключение", async () => {
    mockFetch(() => json(500, { error: "internal" }));
    await assert.rejects(refreshGoogleToken("r"), (e) => isCloudApiError(e) && e.status === 500);
  });

  test("Google недоступен — понятная ошибка", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(refreshGoogleToken("r"), (e) => isCloudApiError(e) && e.status === 0);
  });

  test("Яндекс 401 и 400 invalid_grant — нужно переподключить", async () => {
    mockFetch(() => json(401, { error: "unauthorized" }));
    await assert.rejects(refreshYandexToken("r"), (e) => isCloudReconnectRequiredError(e) && e.provider === "YANDEX_DISK");
    mockFetch(() => json(400, { error: "invalid_grant" }));
    await assert.rejects(refreshYandexToken("r"), isCloudReconnectRequiredError);
  });

  test("отзыв Google — на адрес заглушки вне production, уже отозванный — тоже успех", async () => {
    process.env.CLOUD_STUB_GOOGLE_URL = "http://localhost:4510/google";
    const calls = mockFetch(() => json(400, { error: "invalid_token" }));
    assert.equal(await revokeGoogleToken("t1"), true);
    assert.equal(calls[0].url, "http://localhost:4510/google/revoke");
    assert.equal(String(calls[0].init?.body), "token=t1");
  });

  test("отзыв не бросает при сбое сети", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    assert.equal(await revokeGoogleToken("t1"), false);
  });
});

describe("аккаунт подключения", () => {
  test("почта и sub из id_token", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "1234", email: "a@example.com" })).toString("base64url");
    assert.deepEqual(parseGoogleIdToken(`h.${payload}.s`), { sub: "1234", email: "a@example.com" });
    assert.deepEqual(parseGoogleIdToken(undefined), { sub: null, email: null });
    assert.deepEqual(parseGoogleIdToken("h.%%%.s"), { sub: null, email: null });
  });

  test("device_id Яндекса стабилен и не содержит id пользователя", () => {
    assert.equal(yandexDeviceId("user-1"), yandexDeviceId("user-1"));
    assert.notEqual(yandexDeviceId("user-1"), yandexDeviceId("user-2"));
    assert.equal(yandexDeviceId("user-1").includes("user-1"), false);
    assert.equal(yandexDeviceId("user-1").length, 32);
  });
});

describe("«Вставить ссылку»", () => {
  test("Google: id файла из адреса", () => {
    const link = parseCloudLink("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0");
    assert.ok(!("error" in link));
    assert.equal(link.provider, "GOOGLE_DRIVE");
    assert.equal(link.externalId, "1AbCdEfGhIjKlMnOp");
    const byQuery = parseCloudLink("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp");
    assert.ok(!("error" in byQuery) && byQuery.externalId === "1AbCdEfGhIjKlMnOp");
  });

  test("Яндекс: адрес как есть", () => {
    const link = parseCloudLink("  https://disk.yandex.ru/i/AbCd123 ");
    assert.ok(!("error" in link));
    assert.equal(link.provider, "YANDEX_DISK");
    assert.equal(link.url, "https://disk.yandex.ru/i/AbCd123");
  });

  test("любой другой https-сайт — без источника, в колонке — имя сайта", () => {
    const link = parseCloudLink("https://www.dropbox.com/s/abc/file.pdf?dl=0");
    assert.ok(!("error" in link));
    assert.equal(link.provider, null);
    assert.equal(link.externalId, "https://www.dropbox.com/s/abc/file.pdf?dl=0");
    assert.equal(linkSiteLabel(link.url), "dropbox.com");
    // Похожий на Google адрес — не Google.
    const fake = parseCloudLink("https://drive.google.com.evil.example/file/d/1AbCdEfGhIjKlMnOp");
    assert.ok(!("error" in fake) && fake.provider === null);
    assert.equal(linkSiteLabel(null), "Ссылка");
  });

  test("http, javascript:, data:, ftp, без адреса, с логином — отказ", () => {
    assert.ok("error" in parseCloudLink("http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp"));
    assert.ok("error" in parseCloudLink("http://example.com/x"));
    assert.ok("error" in parseCloudLink("javascript:alert(1)"));
    assert.ok("error" in parseCloudLink("JavaScript:alert(1)"));
    assert.ok("error" in parseCloudLink("data:text/html,<script>alert(1)</script>"));
    assert.ok("error" in parseCloudLink("ftp://example.com/file"));
    assert.ok("error" in parseCloudLink("//example.com/x"));
    assert.ok("error" in parseCloudLink("example.com/x"));
    assert.ok("error" in parseCloudLink("https://user:pass@drive.google.com/x"));
    assert.ok("error" in parseCloudLink(`https://example.com/${"a".repeat(2000)}`));
    assert.ok("error" in parseCloudLink(""));
  });

  test("проверка — на сервере: действие прикрепления вызывает parseCloudLink", () => {
    const source = readFileSync(path.join(process.cwd(), "src/features/cloud/actions.ts"), "utf8");
    assert.match(source, /export async function attachCloudLinkAction[\s\S]*?parseCloudLink\(/);
  });

  test("в href старых ссылок — только http(s)", () => {
    assert.equal(safeExternalHref("javascript:alert(1)"), null);
    assert.equal(safeExternalHref("https://disk.yandex.ru/i/x"), "https://disk.yandex.ru/i/x");
    assert.equal(safeExternalHref(null), null);
  });
});

describe("сообщение после окна согласия", () => {
  test("подключён / отказ / неизвестный код", () => {
    assert.equal(cloudOAuthNotice({ cloud_connected: "google" })?.tone, "success");
    assert.match(cloudOAuthNotice({ cloud_error: "scope" })?.text ?? "", /галочку/);
    assert.equal(cloudOAuthNotice({ cloud_error: "xyz" })?.tone, "error");
    assert.equal(cloudOAuthNotice({}), null);
  });
});
