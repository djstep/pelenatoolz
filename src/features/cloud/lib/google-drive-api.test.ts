import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  GOOGLE_FOLDER_MIME,
  GOOGLE_SHEET_MIME,
  GOOGLE_SHEET_REPLACE_MODE,
  XLSX_MIME,
  createDriveFolder,
  createDrivePermission,
  deleteDrivePermission,
  getDriveFile,
  putGoogleSheetFromXlsx,
  renameDriveFile,
  replaceDriveFileContent,
  trashDriveFile,
  uploadDriveFile,
} from "@/features/cloud/lib/google-drive-api";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";

/** Клиент записи Google Диска на подменённом `fetch`: адреса, заголовки, тела, разбор ошибок. */

const G = "http://stub.test/google";
const TOKEN = "at-123";

type Call = { url: string; method: string; headers: Headers; body: Buffer | null };

const realFetch = globalThis.fetch;
const savedEnv = process.env.CLOUD_STUB_GOOGLE_URL;
let calls: Call[] = [];

function mockFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const body =
      typeof raw === "string" ? Buffer.from(raw) : raw instanceof Uint8Array ? Buffer.from(raw) : null;
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const googleErr = (status: number, opts: { reason?: string; status?: string; details?: string } = {}) =>
  json(status, {
    error: {
      code: status,
      message: "Some text with someone@example.com",
      errors: opts.reason ? [{ reason: opts.reason, message: "x" }] : [],
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.details ? { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: opts.details }] } : {}),
    },
  });

/** Разбор тела multipart/related из запроса: метаданные и содержимое. */
function parseMultipart(call: Call) {
  const ct = call.headers.get("Content-Type") ?? "";
  const boundary = /boundary=(.+)$/.exec(ct)?.[1];
  assert.ok(boundary, "boundary в Content-Type");
  const text = call.body!.toString("latin1");
  const chunks = text.split(`--${boundary}`);
  // ["", part1, part2, "--\r\n"]
  assert.equal(chunks.length, 4);
  assert.equal(chunks[3], "--\r\n");
  const parse = (chunk: string) => {
    const body = chunk.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const sep = body.indexOf("\r\n\r\n");
    return { head: body.slice(0, sep), content: Buffer.from(body.slice(sep + 4), "latin1") };
  };
  const meta = parse(chunks[1]);
  const media = parse(chunks[2]);
  return {
    metaHead: meta.head,
    metadata: JSON.parse(meta.content.toString("utf8")) as Record<string, unknown>,
    mediaHead: media.head,
    media: media.content,
  };
}

async function rejectsWith<T extends Error>(p: Promise<unknown>, cls: new (...a: never[]) => T): Promise<T> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof cls, `ожидали ${cls.name}, получили ${String(e)}`);
    return e;
  }
  assert.fail(`ожидали ${cls.name}, ошибки не было`);
}

beforeEach(() => {
  process.env.CLOUD_STUB_GOOGLE_URL = G;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedEnv === undefined) delete process.env.CLOUD_STUB_GOOGLE_URL;
  else process.env.CLOUD_STUB_GOOGLE_URL = savedEnv;
});

const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x0d, 0x0a, 0x2d, 0x2d, 0x10]);

describe("папки и файлы", () => {
  test("createDriveFolder: POST files, Bearer, папка в родителе", async () => {
    mockFetch(() => json(200, { id: "f1", webViewLink: "https://drive/f1" }));
    const out = await createDriveFolder(TOKEN, { name: "PELENA · Фильм", parentId: "root1" });
    assert.deepEqual(out, { id: "f1", webUrl: "https://drive/f1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${G}/drive/v3/files?fields=id,webViewLink`);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.get("Authorization"), `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(calls[0].body!.toString("utf8")), {
      name: "PELENA · Фильм",
      mimeType: GOOGLE_FOLDER_MIME,
      parents: ["root1"],
    });
  });

  test("createDriveFolder без родителя — без parents (корень «Моего диска»)", async () => {
    mockFetch(() => json(200, { id: "f1", webViewLink: "https://drive/f1" }));
    await createDriveFolder(TOKEN, { name: "X" });
    assert.equal("parents" in JSON.parse(calls[0].body!.toString("utf8")), false);
  });

  test("без заглушки — настоящий адрес Google", async () => {
    delete process.env.CLOUD_STUB_GOOGLE_URL;
    mockFetch(() => json(200, { id: "f1" }));
    await createDriveFolder(TOKEN, { name: "X" });
    assert.ok(calls[0].url.startsWith("https://www.googleapis.com/drive/v3/files?"));
  });

  test("getDriveFile: поля, корзина, 404 → null", async () => {
    mockFetch(() =>
      json(200, { id: "a/b", name: "Вызывной", mimeType: GOOGLE_SHEET_MIME, webViewLink: "u", trashed: true, parents: ["p"] }),
    );
    const file = await getDriveFile(TOKEN, "a/b");
    assert.equal(calls[0].url, `${G}/drive/v3/files/a%2Fb?fields=id,name,mimeType,webViewLink,trashed,parents`);
    assert.equal(calls[0].method, "GET");
    assert.deepEqual(file, { id: "a/b", name: "Вызывной", mimeType: GOOGLE_SHEET_MIME, webUrl: "u", trashed: true, parents: ["p"] });

    mockFetch(() => googleErr(404, { reason: "notFound" }));
    assert.equal(await getDriveFile(TOKEN, "gone"), null);
  });

  test("uploadDriveFile с конвертацией: multipart, metadata.mimeType — Google Таблица", async () => {
    mockFetch(() => json(200, { id: "s1", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s1" }));
    const out = await uploadDriveFile(TOKEN, {
      name: "Вызывной · день 12",
      parentId: "p1",
      content: XLSX,
      sourceMimeType: XLSX_MIME,
      convertToGoogleSheet: true,
    });
    assert.deepEqual(out, { id: "s1", webUrl: "https://sheet/s1", mimeType: GOOGLE_SHEET_MIME });
    const c = calls[0];
    assert.equal(c.url, `${G}/upload/drive/v3/files?uploadType=multipart&fields=id,mimeType,webViewLink`);
    assert.equal(c.method, "POST");
    assert.equal(c.headers.get("Authorization"), `Bearer ${TOKEN}`);
    assert.match(c.headers.get("Content-Type") ?? "", /^multipart\/related; boundary=/);
    const mp = parseMultipart(c);
    assert.match(mp.metaHead, /Content-Type: application\/json; charset=UTF-8/);
    assert.deepEqual(mp.metadata, { name: "Вызывной · день 12", parents: ["p1"], mimeType: GOOGLE_SHEET_MIME });
    assert.equal(mp.mediaHead, `Content-Type: ${XLSX_MIME}`);
    assert.deepEqual(mp.media, XLSX);
  });

  test("uploadDriveFile без конвертации — mimeType в метаданных не задан", async () => {
    mockFetch(() => json(200, { id: "x1", mimeType: XLSX_MIME, webViewLink: "u" }));
    await uploadDriveFile(TOKEN, { name: "a.xlsx", parentId: "p1", content: XLSX, sourceMimeType: XLSX_MIME });
    assert.deepEqual(parseMultipart(calls[0]).metadata, { name: "a.xlsx", parents: ["p1"] });
  });

  test("replaceDriveFileContent: PATCH upload того же id, имя той же операцией", async () => {
    mockFetch(() => json(200, { id: "s1", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s1" }));
    const out = await replaceDriveFileContent(TOKEN, "s1", { content: XLSX, sourceMimeType: XLSX_MIME, name: "версия 2" });
    assert.equal(out.id, "s1");
    assert.equal(calls[0].url, `${G}/upload/drive/v3/files/s1?uploadType=multipart&fields=id,mimeType,webViewLink`);
    assert.equal(calls[0].method, "PATCH");
    const mp = parseMultipart(calls[0]);
    assert.deepEqual(mp.metadata, { name: "версия 2" });
    assert.deepEqual(mp.media, XLSX);
  });

  test("renameDriveFile и trashDriveFile: PATCH метаданных", async () => {
    mockFetch(() => json(200, { id: "s1", name: "Новое", mimeType: GOOGLE_SHEET_MIME }));
    const renamed = await renameDriveFile(TOKEN, "s1", "Новое");
    assert.equal(renamed.name, "Новое");
    assert.equal(calls[0].url, `${G}/drive/v3/files/s1?fields=id,name,mimeType,webViewLink,trashed,parents`);
    assert.equal(calls[0].method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].body!.toString("utf8")), { name: "Новое" });

    mockFetch(() => json(200, { id: "s1", trashed: true }));
    await trashDriveFile(TOKEN, "s1");
    assert.equal(calls[0].method, "PATCH");
    assert.deepEqual(JSON.parse(calls[0].body!.toString("utf8")), { trashed: true });
  });
});

describe("доступы", () => {
  test("createDrivePermission: type=user, роль, письмо в query", async () => {
    mockFetch(() => json(200, { id: "perm-1" }));
    const out = await createDrivePermission(TOKEN, "folder1", {
      email: "head@example.com",
      role: "commenter",
      sendNotificationEmail: false,
    });
    assert.deepEqual(out, { permissionId: "perm-1" });
    assert.equal(calls[0].url, `${G}/drive/v3/files/folder1/permissions?sendNotificationEmail=false&fields=id`);
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(JSON.parse(calls[0].body!.toString("utf8")), {
      type: "user",
      role: "commenter",
      emailAddress: "head@example.com",
    });

    mockFetch(() => json(200, { id: "perm-2" }));
    await createDrivePermission(TOKEN, "folder1", { email: "a@b.c", role: "reader", sendNotificationEmail: true });
    assert.match(calls[0].url, /sendNotificationEmail=true/);
  });

  test("deleteDrivePermission: 204 — снят; 404 — уже снят, не ошибка; 500 — ошибка", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    assert.deepEqual(await deleteDrivePermission(TOKEN, "f1", "perm-1"), { alreadyGone: false });
    assert.equal(calls[0].url, `${G}/drive/v3/files/f1/permissions/perm-1`);
    assert.equal(calls[0].method, "DELETE");

    mockFetch(() => googleErr(404, { reason: "notFound" }));
    assert.deepEqual(await deleteDrivePermission(TOKEN, "f1", "perm-1"), { alreadyGone: true });

    mockFetch(() => googleErr(500, { reason: "backendError" }));
    const e = await rejectsWith(deleteDrivePermission(TOKEN, "f1", "perm-1"), CloudApiError);
    assert.equal(e.status, 500);
  });
});

describe("putGoogleSheetFromXlsx", () => {
  const input = { name: "Вызывной · версия 2", parentId: "p1", content: XLSX };

  test("режим по умолчанию — update", () => {
    assert.equal(GOOGLE_SHEET_REPLACE_MODE, "update");
  });

  test("нет файла → новая Google Таблица (created)", async () => {
    mockFetch(() => json(200, { id: "s1", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s1" }));
    const out = await putGoogleSheetFromXlsx(TOKEN, { ...input, existingFileId: null });
    assert.deepEqual(out, { id: "s1", webUrl: "https://sheet/s1", outcome: "created" });
    assert.equal(calls.length, 1);
    assert.equal(parseMultipart(calls[0]).metadata.mimeType, GOOGLE_SHEET_MIME);
  });

  test("файл удалён (404) → новый (recreated)", async () => {
    mockFetch((_c, i) =>
      i === 0 ? googleErr(404, { reason: "notFound" }) : json(200, { id: "s2", mimeType: GOOGLE_SHEET_MIME, webViewLink: "u2" }),
    );
    const out = await putGoogleSheetFromXlsx(TOKEN, { ...input, existingFileId: "s1" });
    assert.deepEqual(out, { id: "s2", webUrl: "u2", outcome: "recreated" });
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[1].method, "POST");
  });

  test("файл в корзине → новый (recreated), старый не трогаем", async () => {
    mockFetch((_c, i) =>
      i === 0
        ? json(200, { id: "s1", name: "old", mimeType: GOOGLE_SHEET_MIME, trashed: true, parents: ["p1"] })
        : json(200, { id: "s2", mimeType: GOOGLE_SHEET_MIME, webViewLink: "u2" }),
    );
    const out = await putGoogleSheetFromXlsx(TOKEN, { ...input, existingFileId: "s1" }, "update");
    assert.equal(out.outcome, "recreated");
    assert.equal(out.id, "s2");
    assert.equal(calls.length, 2);
  });

  test("update: содержимое в тот же файл, ссылка та же (replaced)", async () => {
    mockFetch((_c, i) =>
      i === 0
        ? json(200, { id: "s1", name: "old", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s1", trashed: false })
        : json(200, { id: "s1", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s1" }),
    );
    const out = await putGoogleSheetFromXlsx(TOKEN, { ...input, existingFileId: "s1" }, "update");
    assert.deepEqual(out, { id: "s1", webUrl: "https://sheet/s1", outcome: "replaced" });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, "PATCH");
    assert.equal(calls[1].url, `${G}/upload/drive/v3/files/s1?uploadType=multipart&fields=id,mimeType,webViewLink`);
    const mp = parseMultipart(calls[1]);
    assert.deepEqual(mp.metadata, { name: input.name });
    assert.equal(mp.mediaHead, `Content-Type: ${XLSX_MIME}`);
  });

  test("recreate: новый файл, старый — в корзину (recreated, ссылка новая)", async () => {
    mockFetch((_c, i) => {
      if (i === 0) return json(200, { id: "s1", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s1" });
      if (i === 1) return json(200, { id: "s2", mimeType: GOOGLE_SHEET_MIME, webViewLink: "https://sheet/s2" });
      return json(200, { id: "s1", trashed: true });
    });
    const out = await putGoogleSheetFromXlsx(TOKEN, { ...input, existingFileId: "s1" }, "recreate");
    assert.deepEqual(out, { id: "s2", webUrl: "https://sheet/s2", outcome: "recreated" });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[2].method, "PATCH");
    assert.equal(calls[2].url, `${G}/drive/v3/files/s1?fields=id,name,mimeType,webViewLink,trashed,parents`);
    assert.deepEqual(JSON.parse(calls[2].body!.toString("utf8")), { trashed: true });
  });

  test("recreate: старый не ушёл в корзину — новый файл всё равно возвращается", async () => {
    mockFetch((_c, i) => {
      if (i === 0) return json(200, { id: "s1", mimeType: GOOGLE_SHEET_MIME });
      if (i === 1) return json(200, { id: "s2", mimeType: GOOGLE_SHEET_MIME, webViewLink: "u2" });
      return googleErr(500, { reason: "backendError" });
    });
    const out = await putGoogleSheetFromXlsx(TOKEN, { ...input, existingFileId: "s1" }, "recreate");
    assert.equal(out.id, "s2");
  });
});

describe("ошибки Google", () => {
  test("401 → переподключить", async () => {
    mockFetch(() => googleErr(401, { reason: "authError", status: "UNAUTHENTICATED" }));
    const e = await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudReconnectRequiredError);
    assert.equal(e.provider, "GOOGLE_DRIVE");
  });

  test("403 без нужных прав (старый drive.readonly) → переподключить", async () => {
    mockFetch(() =>
      googleErr(403, { reason: "insufficientPermissions", status: "PERMISSION_DENIED", details: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }),
    );
    await rejectsWith(uploadDriveFile(TOKEN, { name: "a", parentId: "p", content: XLSX, sourceMimeType: XLSX_MIME }), CloudReconnectRequiredError);

    mockFetch(() => googleErr(403, { status: "PERMISSION_DENIED", details: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }));
    await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudReconnectRequiredError);

    mockFetch(() => googleErr(403, { reason: "insufficientScopes" }));
    await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudReconnectRequiredError);
  });

  test("403 частота выдачи доступов → CloudApiError с причиной", async () => {
    mockFetch(() => googleErr(403, { reason: "sharingRateLimitExceeded" }));
    const e = await rejectsWith(
      createDrivePermission(TOKEN, "f", { email: "a@b.c", role: "commenter", sendNotificationEmail: true }),
      CloudApiError,
    );
    assert.equal(e.status, 403);
    assert.equal(e.reason, "sharingRateLimitExceeded");
    assert.equal(e.message, "Google ограничил частоту запросов — повторите позже");

    mockFetch(() => googleErr(403, { reason: "userRateLimitExceeded" }));
    assert.equal((await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudApiError)).reason, "userRateLimitExceeded");
  });

  test("429 → частота", async () => {
    mockFetch(() => new Response("Too many", { status: 429 }));
    const e = await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudApiError);
    assert.equal(e.status, 429);
    assert.equal(e.reason, "rateLimitExceeded");
    assert.equal(e.message, "Google ограничил частоту запросов — повторите позже");
  });

  test("404 на изменении → notFound", async () => {
    mockFetch(() => googleErr(404, { reason: "notFound" }));
    const e = await rejectsWith(renameDriveFile(TOKEN, "x", "y"), CloudApiError);
    assert.equal(e.status, 404);
    assert.equal(e.reason, "notFound");
  });

  test("прочее — понятный текст без тела ответа (там бывают почты)", async () => {
    mockFetch(() => googleErr(400, { reason: "invalidSharingRequest" }));
    const e = await rejectsWith(
      createDrivePermission(TOKEN, "f", { email: "someone@example.com", role: "commenter", sendNotificationEmail: false }),
      CloudApiError,
    );
    assert.equal(e.reason, "invalidSharingRequest");
    assert.doesNotMatch(e.message, /@/);

    mockFetch(() => googleErr(500, { reason: "backendError" }));
    const e2 = await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudApiError);
    assert.equal(e2.status, 500);
    assert.doesNotMatch(e2.message, /@|Some text/);

    mockFetch(() => googleErr(403, { reason: "storageQuotaExceeded" }));
    assert.equal((await rejectsWith(createDriveFolder(TOKEN, { name: "X" }), CloudApiError)).message, "На Google Диске нет места");
  });

  test("сеть недоступна → status 0", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const e = await rejectsWith(getDriveFile(TOKEN, "x"), CloudApiError);
    assert.equal(e.status, 0);
    assert.equal(e.message, "Google Диск недоступен — попробуйте позже");
  });
});
