import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  inviteAllowsRegistration,
  inviteTokenFromCallback,
  isAllowlisted,
  isInviteActive,
  parseAllowlist,
} from "./registration-access";

const NOW = new Date("2026-11-07T10:00:00Z");
const FUTURE = new Date("2026-11-08T10:00:00Z");
const PAST = new Date("2026-11-06T10:00:00Z");
const TOKEN = "abcDEF0123456789_-abcDEF01234567";
const openInvite = { email: null, expiresAt: FUTURE, acceptedAt: null, revokedAt: null };

describe("список адресов", () => {
  test("разделители: запятая, точка с запятой, пробел, перенос строки", () => {
    const list = parseAllowlist("a@x.ru, b@x.ru;c@x.ru  d@x.ru\ne@x.ru");
    assert.deepEqual([...list].sort(), ["a@x.ru", "b@x.ru", "c@x.ru", "d@x.ru", "e@x.ru"]);
  });

  test("регистр адреса не важен", () => {
    assert.ok(isAllowlisted("Owner@Example.RU", "owner@example.ru"));
    assert.ok(isAllowlisted("owner@example.ru", "OWNER@EXAMPLE.RU"));
  });

  test("пустой список закрывает всех", () => {
    assert.equal(isAllowlisted("owner@example.ru", undefined), false);
    assert.equal(isAllowlisted("owner@example.ru", ""), false);
    assert.equal(isAllowlisted("owner@example.ru", " , ; "), false);
  });

  test("без почты отказ", () => {
    assert.equal(isAllowlisted(null, "owner@example.ru"), false);
    assert.equal(isAllowlisted(undefined, "owner@example.ru"), false);
    assert.equal(isAllowlisted("", "owner@example.ru"), false);
  });

  test("часть адреса не считается совпадением", () => {
    assert.equal(isAllowlisted("owner@example.ru.evil.com", "owner@example.ru"), false);
    assert.equal(isAllowlisted("x-owner@example.ru", "owner@example.ru"), false);
  });

  test("значение без @ в список не попадает", () => {
    assert.equal(parseAllowlist("example.ru *").size, 0);
  });
});

describe("токен из адреса возврата", () => {
  test("обычная ссылка приглашения", () => {
    assert.equal(inviteTokenFromCallback(`/ru/invite/${TOKEN}`), TOKEN);
    assert.equal(inviteTokenFromCallback(`/en/invite/${TOKEN}`), TOKEN);
  });

  test("всё остальное не токен", () => {
    for (const value of [
      undefined,
      null,
      42,
      "",
      "/ru/projects",
      `/ru/invite/${TOKEN}/extra`,
      `/ru/invite/${TOKEN}?x=1`,
      `https://evil.example/ru/invite/${TOKEN}`,
      `//evil.example/ru/invite/${TOKEN}`,
      `/de/invite/${TOKEN}`,
      "/ru/invite/short",
      `/ru/invite/${TOKEN}0`,
    ]) {
      assert.equal(inviteTokenFromCallback(value), null, String(value));
    }
  });
});

describe("приглашение и регистрация", () => {
  test("действующее приглашение без адреса открывает регистрацию любой почте", () => {
    assert.ok(isInviteActive(openInvite, NOW));
    assert.ok(inviteAllowsRegistration(openInvite, "new@example.ru", NOW));
  });

  test("именное приглашение только своей почте, регистр не важен", () => {
    const invite = { ...openInvite, email: "crew@example.ru" };
    assert.ok(inviteAllowsRegistration(invite, "Crew@Example.ru", NOW));
    assert.equal(inviteAllowsRegistration(invite, "other@example.ru", NOW), false);
  });

  test("принятое, отозванное, просроченное и несуществующее не открывают", () => {
    assert.equal(inviteAllowsRegistration({ ...openInvite, acceptedAt: PAST }, "a@x.ru", NOW), false);
    assert.equal(inviteAllowsRegistration({ ...openInvite, revokedAt: PAST }, "a@x.ru", NOW), false);
    assert.equal(inviteAllowsRegistration({ ...openInvite, expiresAt: PAST }, "a@x.ru", NOW), false);
    assert.equal(inviteAllowsRegistration(null, "a@x.ru", NOW), false);
    assert.equal(inviteAllowsRegistration(undefined, "a@x.ru", NOW), false);
  });
});
