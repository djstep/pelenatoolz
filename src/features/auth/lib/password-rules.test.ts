import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COMMON_PASSWORDS } from "@/features/auth/lib/common-passwords";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
} from "@/features/auth/lib/password-rules";

const GOOD = "сценарий-вторник-48";

describe("passwordProblem: длина", () => {
  test("короче 10 символов — нельзя", () => {
    assert.match(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH - 1)) ?? "", /короткий/);
  });

  test("ровно 10 и ровно 128 символов — можно", () => {
    assert.equal(passwordProblem("q7!вёрстка"), null);
    assert.equal(passwordProblem("x".repeat(PASSWORD_MAX_LENGTH)), null);
  });

  test("129 символов — нельзя", () => {
    assert.match(passwordProblem("x".repeat(PASSWORD_MAX_LENGTH + 1)) ?? "", /длинный/);
  });

  test("заглавные и цифры не требуются", () => {
    assert.equal(passwordProblem(GOOD), null);
    assert.equal(passwordProblem("длинная фраза из слов"), null);
  });
});

describe("passwordProblem: частые пароли", () => {
  test("пароль из английского списка", () => {
    assert.match(passwordProblem("qwertyuiop") ?? "", /распространён/);
    assert.match(passwordProblem("1234567890") ?? "", /распространён/);
  });

  test("русские варианты", () => {
    assert.match(passwordProblem("йцукенгшщз") ?? "", /распространён/);
    assert.match(passwordProblem("пароль12345") ?? "", /распространён/);
    assert.match(passwordProblem("gfhjkm1234") ?? "", /распространён/);
  });

  test("регистр и пробелы по краям не спасают", () => {
    assert.match(passwordProblem("QwertyUIOP") ?? "", /распространён/);
    assert.match(passwordProblem(" qwertyuiop ") ?? "", /распространён/);
  });

  test("в списке нет записей короче 10 символов и записей с заглавными", () => {
    for (const item of COMMON_PASSWORDS) {
      assert.ok(item.length >= PASSWORD_MIN_LENGTH, item);
      assert.equal(item, item.toLowerCase());
    }
  });
});

describe("passwordProblem: почта", () => {
  const email = "ivan.petrov@example.com";

  test("равен почте целиком — нельзя", () => {
    assert.match(passwordProblem(email, email) ?? "", /почтой/);
    assert.match(passwordProblem("Ivan.Petrov@Example.COM", email) ?? "", /почтой/);
  });

  test("равен части до @ — нельзя", () => {
    assert.match(passwordProblem("ivan.petrov", email) ?? "", /почтой/);
    assert.match(passwordProblem("IVAN.PETROV", email) ?? "", /почтой/);
  });

  test("содержит часть почты, но не равен ей — можно", () => {
    assert.equal(passwordProblem("ivan.petrov-48-сцена", email), null);
  });

  test("без почты проверки почты нет", () => {
    assert.equal(passwordProblem("ivan.petrov"), null);
    assert.equal(passwordProblem("ivan.petrov", null), null);
  });
});
