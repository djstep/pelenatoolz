import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCloudStub, type CloudStub } from "../../../../e2e/cloud-stub/server";
import { DRIVE_FOLDER_KEYS } from "@/features/cloud/lib/drive-export-rules";
import {
  putCallSheetToGoogle,
  putCallSheetToYandex,
  type DriveFolderStore,
  type StoredDriveFolder,
} from "@/features/cloud/lib/drive-put";
import { GOOGLE_SHEET_MIME, getDriveFile, trashDriveFile } from "@/features/cloud/lib/google-drive-api";
import { yandexWebFolderUrl } from "@/features/cloud/lib/yandex-disk-api";

/**
 * Выгрузка вызывного на личный диск против настоящей заглушки: папки, один файл с заменой,
 * пересоздание удалённого. База не нужна — папки «запоминаются» в памяти теста.
 */

const APP = "http://app.test";
let stub: CloudStub;

type StubState = {
  google: { files: Array<{ id: string; name: string; mimeType: string; parents: string[]; trashed: boolean; contentVersion: number }> };
  yandex: { resources: Array<{ path: string; type: string; contentVersion: number }>; published: unknown[] };
};

const control = async <T>(path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${stub.url}/__stub${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  return (await res.json()) as T;
};

async function login(provider: "google" | "yandex") {
  const base = provider === "google" ? stub.googleUrl : stub.yandexUrl;
  const authorize = provider === "google" ? `${base}/o/oauth2/v2/auth` : `${base}/authorize`;
  const redirectUri = `${APP}/api/cloud/${provider}/callback`;
  const q = new URLSearchParams({ client_id: "cid", redirect_uri: redirectUri, response_type: "code", state: "s" });
  const res = await fetch(`${authorize}?${q}`, { redirect: "manual" });
  const code = new URL(res.headers.get("location") ?? "").searchParams.get("code");
  assert.ok(code);
  const tokenRes = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: "cid", client_secret: "secret" }),
  });
  return ((await tokenRes.json()) as { access_token: string }).access_token;
}

function memoryFolders() {
  const map = new Map<string, StoredDriveFolder>();
  const saves: string[] = [];
  const store: DriveFolderStore = {
    get: (key) => map.get(key) ?? null,
    save: async (key, folder) => {
      saves.push(key);
      map.set(key, folder);
    },
  };
  return { store, map, saves };
}

const XLSX = Buffer.from("PK\u0003\u0004 fake xlsx", "latin1");

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

describe("личный Google Диск", () => {
  test("папки PELENA · Проект/Вызывные, Google Таблица; повторно — тот же файл, новое имя", async () => {
    const token = await login("google");
    const folders = memoryFolders();

    const first = await putCallSheetToGoogle(token, {
      folders: folders.store,
      projectName: "Фильм",
      existingFileId: null,
      fileName: "Вызывной · день 1 · 11.09.2026 · версия 1 (черновик)",
      content: XLSX,
    });
    assert.equal(first.outcome, "created");
    assert.deepEqual(folders.saves, [DRIVE_FOLDER_KEYS.root, DRIVE_FOLDER_KEYS.callSheets]);

    const root = await getDriveFile(token, folders.map.get("root")!.externalId);
    const callSheets = await getDriveFile(token, folders.map.get("callsheets")!.externalId);
    assert.equal(root?.name, "PELENA · Фильм");
    assert.equal(callSheets?.name, "Вызывные");
    assert.deepEqual(callSheets?.parents, [root?.id]);
    const file = await getDriveFile(token, first.externalId);
    assert.equal(file?.mimeType, GOOGLE_SHEET_MIME);
    assert.deepEqual(file?.parents, [callSheets?.id]);

    const second = await putCallSheetToGoogle(token, {
      folders: folders.store,
      projectName: "Фильм",
      existingFileId: first.externalId,
      fileName: "Вызывной · день 1 · 11.09.2026 · версия 1 (утверждён)",
      content: XLSX,
    });
    assert.equal(second.outcome, "replaced");
    assert.equal(second.externalId, first.externalId);
    assert.equal(second.webUrl, first.webUrl);
    assert.equal(folders.saves.length, 2, "папки не создаются второй раз");

    const state = await control<StubState>("/state");
    assert.equal(state.google.files.filter((f) => f.mimeType === GOOGLE_SHEET_MIME).length, 1);
    const sheet = state.google.files.find((f) => f.id === first.externalId);
    assert.equal(sheet?.name, "Вызывной · день 1 · 11.09.2026 · версия 1 (утверждён)");
    assert.equal(sheet?.contentVersion, 2);
  });

  test("файл удалили руками — новый файл, outcome recreated", async () => {
    const token = await login("google");
    const folders = memoryFolders();
    const input = { folders: folders.store, projectName: "Фильм", fileName: "v1", content: XLSX };
    const first = await putCallSheetToGoogle(token, { ...input, existingFileId: null });
    await trashDriveFile(token, first.externalId);

    const again = await putCallSheetToGoogle(token, { ...input, existingFileId: first.externalId });
    assert.equal(again.outcome, "recreated");
    assert.notEqual(again.externalId, first.externalId);
  });

  test("папку «Вызывные» удалили руками — новая папка, новый файл в ней", async () => {
    const token = await login("google");
    const folders = memoryFolders();
    const input = { folders: folders.store, projectName: "Фильм", fileName: "v1", content: XLSX };
    const first = await putCallSheetToGoogle(token, { ...input, existingFileId: null });
    const oldFolderId = folders.map.get("callsheets")!.externalId;
    await trashDriveFile(token, oldFolderId);

    const again = await putCallSheetToGoogle(token, { ...input, existingFileId: first.externalId });
    assert.equal(again.outcome, "recreated");
    const newFolderId = folders.map.get("callsheets")!.externalId;
    assert.notEqual(newFolderId, oldFolderId);
    assert.deepEqual((await getDriveFile(token, again.externalId))?.parents, [newFolderId]);
    // Корневая папка жива — её не пересоздаём.
    assert.deepEqual(folders.saves, ["root", "callsheets", "callsheets"]);
  });

  test("подключили другой аккаунт — чужие папки не видны (drive.file) → всё заново", async () => {
    const tokenA = await login("google");
    const folders = memoryFolders();
    const input = { folders: folders.store, projectName: "Фильм", fileName: "v1", content: XLSX };
    const first = await putCallSheetToGoogle(tokenA, { ...input, existingFileId: null });

    await control("/config", { google: { sub: "other-sub", email: "other@example.com" } });
    const tokenB = await login("google");
    const again = await putCallSheetToGoogle(tokenB, { ...input, existingFileId: first.externalId });
    assert.equal(again.outcome, "recreated");
    assert.notEqual(again.externalId, first.externalId);
  });
});

describe("личный Яндекс Диск", () => {
  test("папка приложения <Проект> · <id>/Вызывные, .xlsx; повторно — тот же файл переименован и перезаписан", async () => {
    const token = await login("yandex");
    const folders = memoryFolders();

    const first = await putCallSheetToYandex(token, {
      folders: folders.store,
      projectId: "proj-0000-abc123",
      projectName: "Фильм",
      existingPath: null,
      fileName: "Вызывной · день 1 · 11.09.2026 · версия 1 (черновик)",
      content: XLSX,
    });
    assert.equal(first.outcome, "created");
    assert.equal(first.externalId, "app:/Фильм · abc123/Вызывные/Вызывной · день 1 · 11.09.2026 · версия 1 (черновик).xlsx");
    assert.deepEqual(
      [...folders.map.entries()].map(([k, v]) => [k, v.externalId]),
      [
        ["root", "app:/Фильм · abc123"],
        ["callsheets", "app:/Фильм · abc123/Вызывные"],
      ],
    );
    // Заглушка отдаёт путь `app:/…`; настоящий Яндекс — `disk:/Приложения/…`.
    assert.equal(first.webUrl, yandexWebFolderUrl("app:/Фильм · abc123/Вызывные"));

    const second = await putCallSheetToYandex(token, {
      folders: folders.store,
      projectId: "proj-0000-abc123",
      projectName: "Фильм",
      existingPath: first.externalId,
      fileName: "Вызывной · день 1 · 11.09.2026 · версия 2 (утверждён)",
      content: XLSX,
    });
    assert.equal(second.outcome, "replaced");
    assert.equal(second.webUrl, first.webUrl);

    const state = await control<StubState>("/state");
    const files = state.yandex.resources.filter((r) => r.type === "file");
    assert.deepEqual(
      files.map((f) => [f.path, f.contentVersion]),
      [["app:/Фильм · abc123/Вызывные/Вызывной · день 1 · 11.09.2026 · версия 2 (утверждён).xlsx", 2]],
    );
    assert.equal(state.yandex.published.length, 0, "ничего не публикуется по ссылке");
  });

  test("прежнего файла нет — создан заново", async () => {
    const token = await login("yandex");
    const folders = memoryFolders();
    const again = await putCallSheetToYandex(token, {
      folders: folders.store,
      projectId: "proj-0000-abc123",
      projectName: "Фильм / сезон 2",
      existingPath: "app:/Фильм - сезон 2 · abc123/Вызывные/старое.xlsx",
      fileName: "новое",
      content: XLSX,
    });
    assert.equal(again.outcome, "recreated");
    // «/» в названии проекта не дробит путь.
    assert.equal(again.externalId, "app:/Фильм - сезон 2 · abc123/Вызывные/новое.xlsx");
  });
});

describe("ссылка на папку Яндекс Диска", () => {
  test("disk:/ → веб-версия; иное — «Приложения»", () => {
    assert.equal(
      yandexWebFolderUrl("disk:/Приложения/PELENA/Фильм/Вызывные"),
      `https://disk.yandex.ru/client/disk/${["Приложения", "PELENA", "Фильм", "Вызывные"].map(encodeURIComponent).join("/")}`,
    );
    assert.equal(yandexWebFolderUrl(null), `https://disk.yandex.ru/client/disk/${encodeURIComponent("Приложения")}`);
  });
});
