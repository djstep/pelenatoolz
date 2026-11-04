import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clientIp,
  LOGIN_EMAIL_RATE_LIMIT,
  LOGIN_RATE_LIMIT,
  loginLimitEmailKey,
  loginLimitEmailPrefix,
  loginLimitKey,
} from "@/features/auth/lib/login-limit";

describe("clientIp", () => {
  test("один адрес", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
  });

  test("цепочка: берём последний адрес, подставленные посетителем левее не учитываем", () => {
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2 , 203.0.113.7" });
    assert.equal(clientIp(headers), "203.0.113.7");
  });

  test("нет x-forwarded-for — x-real-ip", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.8" })), "203.0.113.8");
  });

  test("нет заголовков — общий ключ, а не ошибка", () => {
    assert.equal(clientIp(new Headers()), "unknown");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": " , " })), "unknown");
  });
});

describe("loginLimitKey", () => {
  const ip = "203.0.113.7";

  test("почта и IP не лежат в открытом виде", () => {
    const key = loginLimitKey("ivan@example.com", ip);
    assert.ok(!key.includes("ivan"));
    assert.ok(!key.includes("example"));
    assert.ok(!key.includes(ip));
  });

  test("регистр почты не даёт лишних попыток", () => {
    assert.equal(loginLimitKey("Ivan@Example.com", ip), loginLimitKey("ivan@example.com", ip));
  });

  test("разные пары — разные ключи", () => {
    const base = loginLimitKey("ivan@example.com", ip);
    assert.notEqual(base, loginLimitKey("ivan@example.com", "203.0.113.8"));
    assert.notEqual(base, loginLimitKey("petr@example.com", ip));
  });

  test("начало ключа общее для всех IP одной почты", () => {
    const prefix = loginLimitEmailPrefix("ivan@example.com");
    assert.ok(loginLimitKey("ivan@example.com", ip).startsWith(prefix));
    assert.ok(loginLimitKey("ivan@example.com", "203.0.113.8").startsWith(prefix));
    assert.ok(!loginLimitKey("petr@example.com", ip).startsWith(prefix));
  });
});

describe("loginLimitEmailKey", () => {
  test("почта не лежит в открытом виде, регистр не важен", () => {
    const key = loginLimitEmailKey("Ivan@Example.com");
    assert.ok(!key.toLowerCase().includes("ivan"));
    assert.equal(key, loginLimitEmailKey("ivan@example.com"));
  });

  test("не совпадает с ключом пары и входит в общее начало ключей почты", () => {
    const key = loginLimitEmailKey("ivan@example.com");
    assert.notEqual(key, loginLimitKey("ivan@example.com", "all"));
    assert.ok(key.startsWith(loginLimitEmailPrefix("ivan@example.com")));
  });
});

describe("лимиты входа", () => {
  test("пара: 5 попыток, окно и блок по 15 минут", () => {
    assert.deepEqual(LOGIN_RATE_LIMIT, { limit: 5, windowMs: 900_000, blockMs: 900_000 });
  });

  test("почта: 20 попыток за час, блок 15 минут", () => {
    assert.deepEqual(LOGIN_EMAIL_RATE_LIMIT, { limit: 20, windowMs: 3_600_000, blockMs: 900_000 });
  });
});
