import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isSessionVersionCurrent } from "@/features/auth/lib/session-version";

describe("isSessionVersionCurrent", () => {
  test("номер совпал — сессия действует", () => {
    assert.equal(isSessionVersionCurrent(3, 3), true);
  });

  test("пароль сменили после выдачи сессии — не действует", () => {
    assert.equal(isSessionVersionCurrent(2, 3), false);
  });

  test("сессия старше доработки: без номера действует, пока пароль не меняли", () => {
    assert.equal(isSessionVersionCurrent(undefined, 0), true);
    assert.equal(isSessionVersionCurrent(undefined, 1), false);
  });

  test("пользователя больше нет — не действует", () => {
    assert.equal(isSessionVersionCurrent(0, null), false);
    assert.equal(isSessionVersionCurrent(undefined, undefined), false);
  });

  test("мусор вместо номера считается нулём, а не совпадением", () => {
    assert.equal(isSessionVersionCurrent("3", 3), false);
  });
});
