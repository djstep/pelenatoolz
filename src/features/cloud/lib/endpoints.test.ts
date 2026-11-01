import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { googleEndpoints, yandexEndpoints } from "@/features/cloud/lib/endpoints";

/** Подмена адресов Google / Яндекса заглушкой — только вне production. */

const env = process.env as Record<string, string | undefined>;
const saved = {
  NODE_ENV: env.NODE_ENV,
  CLOUD_STUB_GOOGLE_URL: env.CLOUD_STUB_GOOGLE_URL,
  CLOUD_STUB_YANDEX_URL: env.CLOUD_STUB_YANDEX_URL,
};

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

describe("адреса дисков", () => {
  test("без переменных — настоящие адреса", () => {
    delete env.CLOUD_STUB_GOOGLE_URL;
    delete env.CLOUD_STUB_YANDEX_URL;
    env.NODE_ENV = "development";
    assert.equal(googleEndpoints().driveApi, "https://www.googleapis.com/drive/v3");
    assert.equal(googleEndpoints().driveUpload, "https://www.googleapis.com/upload/drive/v3");
    assert.equal(yandexEndpoints().diskApi, "https://cloud-api.yandex.net/v1/disk");
  });

  test("вне production — адрес заглушки (без «/» в конце)", () => {
    env.NODE_ENV = "test";
    env.CLOUD_STUB_GOOGLE_URL = "http://127.0.0.1:4510/google/";
    env.CLOUD_STUB_YANDEX_URL = " http://127.0.0.1:4510/yandex ";
    assert.deepEqual(googleEndpoints(), {
      authorize: "http://127.0.0.1:4510/google/o/oauth2/v2/auth",
      token: "http://127.0.0.1:4510/google/token",
      revoke: "http://127.0.0.1:4510/google/revoke",
      driveApi: "http://127.0.0.1:4510/google/drive/v3",
      driveUpload: "http://127.0.0.1:4510/google/upload/drive/v3",
    });
    assert.deepEqual(yandexEndpoints(), {
      authorize: "http://127.0.0.1:4510/yandex/authorize",
      token: "http://127.0.0.1:4510/yandex/token",
      revoke: "http://127.0.0.1:4510/yandex/revoke_token",
      userInfo: "http://127.0.0.1:4510/yandex/info",
      diskApi: "http://127.0.0.1:4510/yandex/v1/disk",
    });
  });

  test("production — переменные заглушки не читаются", () => {
    env.NODE_ENV = "production";
    env.CLOUD_STUB_GOOGLE_URL = "http://evil.test/google";
    env.CLOUD_STUB_YANDEX_URL = "http://evil.test/yandex";
    assert.equal(googleEndpoints().token, "https://oauth2.googleapis.com/token");
    assert.equal(googleEndpoints().driveApi, "https://www.googleapis.com/drive/v3");
    assert.equal(yandexEndpoints().token, "https://oauth.yandex.ru/token");
    assert.equal(yandexEndpoints().diskApi, "https://cloud-api.yandex.net/v1/disk");
  });
});
