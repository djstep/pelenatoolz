import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCloudStub, type CloudStub } from "../../../../e2e/cloud-stub/server";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";
import {
  GOOGLE_SHEET_MIME,
  createDriveFolder,
  createDrivePermission,
  deleteDrivePermission,
  getDriveFile,
  listDrivePermissions,
  putGoogleSheetFromXlsx,
} from "@/features/cloud/lib/google-drive-api";
import {
  ensureYandexFolder,
  getYandexResource,
  publishYandexResource,
  uploadYandexFile,
  yandexAppPath,
} from "@/features/cloud/lib/yandex-disk-api";

/**
 * Клиенты записи против настоящей заглушки (`e2e/cloud-stub/server.ts`), без подмены `fetch`.
 * Тест лежит в `src/`, потому что `npm test` собирает только `src/**\/*.test.ts`.
 */

const APP = "http://app.test";
let stub: CloudStub;

type StubState = {
  google: {
    files: Array<{ id: string; name: string; mimeType: string; parents: string[]; trashed: boolean; contentVersion: number }>;
    permissions: Array<{ id: string; fileId: string; role: string; emailAddress: string; sendNotificationEmail: boolean }>;
    revokedTokens: string[];
  };
  yandex: {
    resources: Array<{ path: string; type: string; size: number; contentVersion: number; publicUrl: string | null }>;
    published: Array<{ path: string; publicUrl: string }>;
  };
};
type LogEntry = { op: string | null; provider: string | null; body: unknown; status: number; auth: string | null };

const control = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${stub.url}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as T;
};

/** Окно согласия → код → токены (как сделает маршрут callback шага 1). */
async function login(provider: "google" | "yandex") {
  const base = provider === "google" ? stub.googleUrl : stub.yandexUrl;
  const authorize = provider === "google" ? `${base}/o/oauth2/v2/auth` : `${base}/authorize`;
  const redirectUri = `${APP}/api/cloud/${provider}/callback`;
  const q = new URLSearchParams({ client_id: "cid", redirect_uri: redirectUri, response_type: "code", state: "st-1" });
  const res = await fetch(`${authorize}?${q}`, { redirect: "manual" });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location") ?? "");
  assert.equal(location.origin + location.pathname, redirectUri);
  assert.equal(location.searchParams.get("state"), "st-1");
  const code = location.searchParams.get("code");
  assert.ok(code);

  const tokenRes = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: "cid", client_secret: "secret" }),
  });
  assert.equal(tokenRes.status, 200);
  return (await tokenRes.json()) as { access_token: string; refresh_token: string; scope: string; id_token?: string };
}

const XLSX = Buffer.from("PK\u0003\u0004 fake xlsx content", "latin1");

before(async () => {
  stub = await startCloudStub({ port: 0, appOrigin: APP });
  process.env.CLOUD_STUB_GOOGLE_URL = stub.googleUrl;
  process.env.CLOUD_STUB_YANDEX_URL = stub.yandexUrl;
});

after(async () => {
  delete process.env.CLOUD_STUB_GOOGLE_URL;
  delete process.env.CLOUD_STUB_YANDEX_URL;
  await stub.close();
});

beforeEach(async () => {
  await control("/reset", {});
});

describe("заглушка: Google", () => {
  test("вход: код, токены, id_token с почтой и scope drive.file", async () => {
    await control("/config", { google: { email: "keeper@example.com", sub: "sub-42" } });
    const t = await login("google");
    assert.match(t.scope, /auth\/drive\.file/);
    const payload = JSON.parse(Buffer.from(t.id_token!.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    assert.equal(payload.email, "keeper@example.com");
    assert.equal(payload.sub, "sub-42");
    assert.equal(payload.email_verified, true);
    assert.equal(payload.aud, "cid");

    // Окно согласия: отказ человека.
    await control("/config", { google: { authorizeError: "access_denied" } });
    const res = await fetch(`${stub.googleUrl}/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent(`${APP}/cb`)}&state=s`, {
      redirect: "manual",
    });
    const loc = new URL(res.headers.get("location") ?? "");
    assert.equal(loc.searchParams.get("error"), "access_denied");
    assert.equal(loc.searchParams.get("code"), null);

    // Чужой адрес возврата — отказ.
    const bad = await fetch(`${stub.googleUrl}/o/oauth2/v2/auth?redirect_uri=${encodeURIComponent("http://evil.test/cb")}`, {
      redirect: "manual",
    });
    assert.equal(bad.status, 400);
  });

  test("папки, таблица, замена (тот же id), доступ, снятие", async () => {
    const { access_token: token } = await login("google");
    const root = await createDriveFolder(token, { name: "PELENA · Фильм" });
    const common = await createDriveFolder(token, { name: "Общая", parentId: root.id });
    assert.ok(common.webUrl?.startsWith(stub.googleUrl));

    const first = await putGoogleSheetFromXlsx(token, { name: "Вызывной · версия 1", parentId: common.id, content: XLSX });
    assert.equal(first.outcome, "created");
    const second = await putGoogleSheetFromXlsx(token, {
      existingFileId: first.id,
      name: "Вызывной · версия 2",
      parentId: common.id,
      content: XLSX,
    });
    assert.equal(second.outcome, "replaced");
    assert.equal(second.id, first.id);
    assert.equal(second.webUrl, first.webUrl);

    const file = await getDriveFile(token, first.id);
    assert.equal(file?.mimeType, GOOGLE_SHEET_MIME);
    assert.equal(file?.name, "Вызывной · версия 2");
    assert.deepEqual(file?.parents, [common.id]);

    const perm = await createDrivePermission(token, common.id, {
      email: "head@example.com",
      role: "commenter",
      sendNotificationEmail: true,
    });
    let state = await control<StubState>("/state");
    const sheet = state.google.files.find((f) => f.id === first.id);
    assert.equal(sheet?.contentVersion, 2);
    assert.deepEqual(
      state.google.permissions.map((p) => [p.fileId, p.id, p.role, p.emailAddress]),
      [[common.id, perm.permissionId, "commenter", "head@example.com"]],
    );

    // Список доступов: владелец, выданный системой и выданный «руками» (через управление заглушкой).
    await control(`/google/files/${common.id}/permissions`, { email: "friend@gmail.com", role: "writer" });
    const listed = await listDrivePermissions(token, common.id);
    assert.deepEqual(
      listed.map((p) => [p.role, p.email]),
      [
        ["owner", "stub-google@example.com"],
        ["commenter", "head@example.com"],
        ["writer", "friend@gmail.com"],
      ],
    );
    assert.equal(listed[1].id, perm.permissionId);
    await assert.rejects(listDrivePermissions(token, "no-such-folder"), (e: unknown) => e instanceof CloudApiError && e.status === 404);
    await control(`/google/files/${common.id}/permissions`, { email: "friend@gmail.com" });

    assert.deepEqual(await deleteDrivePermission(token, common.id, perm.permissionId), { alreadyGone: false });
    assert.deepEqual(await deleteDrivePermission(token, common.id, perm.permissionId), { alreadyGone: true });
    state = await control<StubState>("/state");
    assert.deepEqual(state.google.permissions.map((p) => p.emailAddress), ["friend@gmail.com"]);

    // Журнал: загрузка без бинарного содержимого — метаданные и размер.
    const log = await control<LogEntry[]>("/requests");
    const upload = log.find((e) => e.op === "files.update");
    assert.deepEqual(upload?.body, {
      metadata: { name: "Вызывной · версия 2" },
      media: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: XLSX.length },
    });
    assert.equal(upload?.auth, "Bearer");
    const tokenCall = log.find((e) => e.op === "token-code");
    assert.equal((tokenCall?.body as Record<string, string>).client_secret, "[скрыт]");
  });

  test("recreate и файл в корзине → новый файл", async () => {
    const { access_token: token } = await login("google");
    const folder = await createDriveFolder(token, { name: "Общая" });
    const first = await putGoogleSheetFromXlsx(token, { name: "v1", parentId: folder.id, content: XLSX });
    const re = await putGoogleSheetFromXlsx(
      token,
      { existingFileId: first.id, name: "v2", parentId: folder.id, content: XLSX },
      "recreate",
    );
    assert.equal(re.outcome, "recreated");
    assert.notEqual(re.id, first.id);
    assert.equal((await getDriveFile(token, first.id))?.trashed, true);

    // Старый в корзине → снова новый, даже в режиме update.
    const again = await putGoogleSheetFromXlsx(token, { existingFileId: first.id, name: "v3", parentId: folder.id, content: XLSX });
    assert.equal(again.outcome, "recreated");
  });

  test("отозванный токен и старые права → переподключить; управляемые отказы", async () => {
    const { access_token: token, refresh_token: refresh } = await login("google");
    const folder = await createDriveFolder(token, { name: "Общая" });

    await control("/config", {
      failNext: [{ provider: "google", match: "permissions.create", status: 403, body: { error: { code: 403, errors: [{ reason: "sharingRateLimitExceeded" }] } } }],
    });
    await assert.rejects(
      createDrivePermission(token, folder.id, { email: "a@example.com", role: "commenter", sendNotificationEmail: true }),
      (err: unknown) => err instanceof CloudApiError && err.reason === "sharingRateLimitExceeded",
    );
    // Отказ разовый.
    await createDrivePermission(token, folder.id, { email: "a@example.com", role: "commenter", sendNotificationEmail: true });

    // Обновление токена: управляемый invalid_grant.
    await control("/config", { failNext: [{ provider: "google", match: "token-refresh", status: 400 }] });
    const refreshRes = await fetch(`${stub.googleUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
    });
    assert.equal(refreshRes.status, 400);
    assert.equal(((await refreshRes.json()) as { error: string }).error, "invalid_grant");

    // Отзыв: токен доступа больше не работает, обновление — invalid_grant.
    const revoke = await fetch(`${stub.googleUrl}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refresh }),
    });
    assert.equal(revoke.status, 200);
    await assert.rejects(createDriveFolder(token, { name: "X" }), CloudReconnectRequiredError);
    const state = await control<StubState>("/state");
    assert.deepEqual(state.google.revokedTokens, [refresh]);

    // Старое подключение с drive.readonly: запись → 403 scope → переподключить.
    await control("/config", { google: { scope: "https://www.googleapis.com/auth/drive.readonly email profile" } });
    const old = await login("google");
    await assert.rejects(createDriveFolder(old.access_token, { name: "X" }), CloudReconnectRequiredError);
  });

  test("файлы другого аккаунта не видны (drive.file)", async () => {
    const a = await login("google");
    const folder = await createDriveFolder(a.access_token, { name: "Общая" });
    await control("/config", { google: { sub: "other-sub", email: "other@example.com" } });
    const b = await login("google");
    assert.equal(await getDriveFile(b.access_token, folder.id), null);
  });
});

describe("заглушка: Яндекс", () => {
  test("папки, загрузка, перезапись, публикация", async () => {
    const t = await login("yandex");
    assert.equal(t.scope, "cloud_api:disk.app_folder");
    const info = await fetch(`${stub.yandexUrl}/info?format=json`, { headers: { Authorization: `OAuth ${t.access_token}` } });
    assert.equal(((await info.json()) as { default_email: string }).default_email, "stub-yandex@example.com");

    const dir = yandexAppPath("PELENA", "Фильм", "Вызывные");
    await ensureYandexFolder(t.access_token, dir);
    await ensureYandexFolder(t.access_token, dir); // повтор — без ошибок
    const filePath = `${dir}/Вызывной · день 12.xlsx`;
    await uploadYandexFile(t.access_token, filePath, XLSX, { overwrite: true });
    await uploadYandexFile(t.access_token, filePath, Buffer.concat([XLSX, XLSX]), { overwrite: true });

    const res = await getYandexResource(t.access_token, filePath);
    assert.equal(res?.type, "file");
    assert.equal(res?.size, XLSX.length * 2);
    assert.equal(res?.publicUrl, null);

    const { publicUrl } = await publishYandexResource(t.access_token, filePath);
    assert.ok(publicUrl.startsWith(stub.yandexUrl));
    assert.equal((await getYandexResource(t.access_token, filePath))?.publicUrl, publicUrl);

    const state = await control<StubState>("/state");
    assert.deepEqual(
      state.yandex.resources.map((r) => [r.path, r.type]),
      [
        ["app:/PELENA", "dir"],
        ["app:/PELENA/Фильм", "dir"],
        [dir, "dir"],
        [filePath, "file"],
      ],
    );
    assert.equal(state.yandex.resources[3].contentVersion, 2);
    assert.deepEqual(state.yandex.published, [{ ownerId: "1000001", path: filePath, publicUrl }]);

    const content = await fetch(`${stub.url}/__stub/yandex/content?path=${encodeURIComponent(filePath)}`);
    assert.equal(Buffer.from(await content.arrayBuffer()).length, XLSX.length * 2);
  });

  test("вне папки приложения — нет прав; отозванный токен → переподключить", async () => {
    const t = await login("yandex");
    await assert.rejects(
      ensureYandexFolder(t.access_token, "disk:/Чужое"),
      (err: unknown) => err instanceof CloudApiError && err.status === 403 && err.reason === "DiskForbiddenError",
    );
    const revoke = await fetch(`${stub.yandexUrl}/revoke_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: t.access_token }),
    });
    assert.equal(revoke.status, 200);
    await assert.rejects(getYandexResource(t.access_token, "app:/x"), CloudReconnectRequiredError);
  });
});
