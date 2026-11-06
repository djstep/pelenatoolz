import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { searchCities } from "./city-geocoding";

const realFetch = globalThis.fetch;

function stubFetch(handler: () => Response | Promise<Response>) {
  globalThis.fetch = (async () => handler()) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("поиск города", () => {
  test("найденные города", async () => {
    stubFetch(() =>
      Response.json({
        results: [
          { id: 1, name: "Санкт-Петербург", latitude: 59.9, longitude: 30.3, country: "Россия", country_code: "RU" },
        ],
      }),
    );
    const results = await searchCities("Санкт");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.label, "Санкт-Петербург, Россия");
  });

  test("пусто — это пустой список, а не ошибка", async () => {
    stubFetch(() => Response.json({}));
    assert.deepEqual(await searchCities("Нетакогогорода"), []);
  });

  test("короткий запрос не идёт в сервис", async () => {
    stubFetch(() => {
      throw new Error("запроса быть не должно");
    });
    assert.deepEqual(await searchCities("а"), []);
  });

  test("ошибка сервиса — не пустой результат", async () => {
    stubFetch(() => new Response("сбой", { status: 500 }));
    await assert.rejects(searchCities("Москва"), /500/);
  });

  test("обрыв соединения — не пустой результат", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(searchCities("Москва"), /fetch failed/);
  });
});
