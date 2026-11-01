import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  ensureYandexFolder,
  getYandexResource,
  publishYandexResource,
  uploadYandexFile,
  yandexAppPath,
} from "@/features/cloud/lib/yandex-disk-api";
import { CloudApiError, CloudReconnectRequiredError } from "@/features/cloud/lib/errors";

/** Клиент записи Яндекс Диска на подменённом `fetch`. */

const Y = "http://stub.test/yandex";
const D = `${Y}/v1/disk`;
const TOKEN = "y-at-1";

type Call = { url: URL; method: string; headers: Headers; body: Buffer | null };

const realFetch = globalThis.fetch;
const savedEnv = process.env.CLOUD_STUB_YANDEX_URL;
let calls: Call[] = [];

function mockFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const body =
      typeof raw === "string" ? Buffer.from(raw) : raw instanceof Uint8Array ? Buffer.from(raw) : null;
    const call: Call = { url: new URL(String(input)), method: init?.method ?? "GET", headers: new Headers(init?.headers), body };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const yErr = (status: number, error: string) =>
  json(status, { error, message: "текст для someone@example.com", description: "x" });

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
  process.env.CLOUD_STUB_YANDEX_URL = Y;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedEnv === undefined) delete process.env.CLOUD_STUB_YANDEX_URL;
  else process.env.CLOUD_STUB_YANDEX_URL = savedEnv;
});

describe("yandexAppPath", () => {
  test("части через «/», слэши внутри названия не дробят путь", () => {
    assert.equal(yandexAppPath("PELENA", "Фильм 1/2", "Вызывные"), "app:/PELENA/Фильм 1-2/Вызывные");
    assert.equal(yandexAppPath("PELENA", "..", " ", "a\\b"), "app:/PELENA/_/a-b");
  });
});

describe("ensureYandexFolder", () => {
  test("создаёт папку и родителей по очереди; 409 «уже есть» — не ошибка", async () => {
    mockFetch((_c, i) =>
      i === 0 ? yErr(409, "DiskPathPointsToExistentDirectoryError") : json(201, { href: "x", method: "GET" }),
    );
    await ensureYandexFolder(TOKEN, "app:/PELENA/Фильм/Вызывные");
    assert.deepEqual(
      calls.map((c) => [c.method, c.url.origin + c.url.pathname, c.url.searchParams.get("path")]),
      [
        ["PUT", `${D}/resources`, "app:/PELENA"],
        ["PUT", `${D}/resources`, "app:/PELENA/Фильм"],
        ["PUT", `${D}/resources`, "app:/PELENA/Фильм/Вызывные"],
      ],
    );
    for (const c of calls) assert.equal(c.headers.get("Authorization"), `OAuth ${TOKEN}`);
  });

  test("409 «нет родителя» — ошибка; путь без app:/ — ошибка программиста", async () => {
    mockFetch(() => yErr(409, "DiskPathDoesntExistsError"));
    const e = await rejectsWith(ensureYandexFolder(TOKEN, "app:/A"), CloudApiError);
    assert.equal(e.reason, "DiskPathDoesntExistsError");
    await assert.rejects(ensureYandexFolder(TOKEN, "/A/B"));
  });
});

describe("ресурсы", () => {
  test("getYandexResource: поля; 404 → null", async () => {
    mockFetch(() =>
      json(200, { path: "disk:/Приложения/PELENA/a.xlsx", name: "a.xlsx", type: "file", size: 12, public_url: "https://yadi.sk/d/x" }),
    );
    const r = await getYandexResource(TOKEN, "app:/a.xlsx");
    assert.deepEqual(r, {
      path: "disk:/Приложения/PELENA/a.xlsx",
      name: "a.xlsx",
      type: "file",
      size: 12,
      publicUrl: "https://yadi.sk/d/x",
    });
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url.searchParams.get("path"), "app:/a.xlsx");
    assert.equal(calls[0].url.searchParams.get("fields"), "path,name,type,public_url,size");

    mockFetch(() => yErr(404, "DiskNotFoundError"));
    assert.equal(await getYandexResource(TOKEN, "app:/nope"), null);
  });

  test("uploadYandexFile: ссылка загрузки с overwrite=true, затем PUT по href без авторизации", async () => {
    const content = Buffer.from([1, 2, 3, 0, 255]);
    mockFetch((_c, i) =>
      i === 0
        ? json(200, { href: "http://uploader.test/put/abc", method: "PUT", templated: false })
        : new Response(null, { status: 201 }),
    );
    const out = await uploadYandexFile(TOKEN, "app:/PELENA/a.xlsx", content, { overwrite: true });
    assert.deepEqual(out, { path: "app:/PELENA/a.xlsx" });
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].url.origin + calls[0].url.pathname, `${D}/resources/upload`);
    assert.equal(calls[0].url.searchParams.get("path"), "app:/PELENA/a.xlsx");
    assert.equal(calls[0].url.searchParams.get("overwrite"), "true");
    assert.equal(calls[0].headers.get("Authorization"), `OAuth ${TOKEN}`);
    assert.equal(calls[1].url.toString(), "http://uploader.test/put/abc");
    assert.equal(calls[1].method, "PUT");
    assert.equal(calls[1].headers.get("Authorization"), null);
    assert.deepEqual(calls[1].body, content);
  });

  test("uploadYandexFile: 507 при загрузке содержимого → «нет места»", async () => {
    mockFetch((_c, i) =>
      i === 0 ? json(200, { href: "http://uploader.test/put/abc", method: "PUT" }) : new Response("", { status: 507 }),
    );
    const e = await rejectsWith(uploadYandexFile(TOKEN, "app:/a.xlsx", Buffer.from("x")), CloudApiError);
    assert.equal(e.status, 507);
    assert.equal(e.message, "На Яндекс Диске нет места");
  });

  test("publishYandexResource: PUT publish, затем public_url", async () => {
    mockFetch((_c, i) =>
      i === 0 ? json(200, { href: `${D}/resources?path=app%3A%2Fa`, method: "GET" }) : json(200, { public_url: "https://yadi.sk/d/k" }),
    );
    const out = await publishYandexResource(TOKEN, "app:/a.xlsx");
    assert.deepEqual(out, { publicUrl: "https://yadi.sk/d/k" });
    assert.equal(calls[0].method, "PUT");
    assert.equal(calls[0].url.origin + calls[0].url.pathname, `${D}/resources/publish`);
    assert.equal(calls[0].url.searchParams.get("path"), "app:/a.xlsx");
    assert.equal(calls[1].method, "GET");
    assert.equal(calls[1].url.searchParams.get("fields"), "public_url");
  });
});

describe("ошибки Яндекса", () => {
  test("401 → переподключить", async () => {
    mockFetch(() => yErr(401, "UnauthorizedError"));
    const e = await rejectsWith(getYandexResource(TOKEN, "app:/a"), CloudReconnectRequiredError);
    assert.equal(e.provider, "YANDEX_DISK");
  });

  test("403 → «нет прав», причина из error; текст ответа не попадает", async () => {
    mockFetch(() => yErr(403, "DiskForbiddenError"));
    const e = await rejectsWith(ensureYandexFolder(TOKEN, "app:/a"), CloudApiError);
    assert.equal(e.status, 403);
    assert.equal(e.reason, "DiskForbiddenError");
    assert.equal(e.message, "Нет прав на эту папку Яндекс Диска");
    assert.doesNotMatch(e.message, /@/);
  });

  test("404 на публикации → notFound; 429 → частота; 500 → понятный текст", async () => {
    mockFetch(() => yErr(404, "DiskNotFoundError"));
    assert.equal((await rejectsWith(publishYandexResource(TOKEN, "app:/a"), CloudApiError)).reason, "notFound");

    mockFetch(() => yErr(429, "TooManyRequestsError"));
    const e = await rejectsWith(uploadYandexFile(TOKEN, "app:/a", Buffer.from("x")), CloudApiError);
    assert.equal(e.status, 429);
    assert.equal(e.message, "Яндекс ограничил частоту запросов — повторите позже");

    mockFetch(() => new Response("oops", { status: 503 }));
    const e2 = await rejectsWith(getYandexResource(TOKEN, "app:/a"), CloudApiError);
    assert.equal(e2.status, 503);
    assert.equal(e2.reason, null);
  });

  test("сеть недоступна → status 0", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const e = await rejectsWith(ensureYandexFolder(TOKEN, "app:/a"), CloudApiError);
    assert.equal(e.status, 0);
    assert.equal(e.message, "Яндекс Диск недоступен — попробуйте позже");
  });
});
