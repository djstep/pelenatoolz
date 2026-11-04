import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { passwordProblem } from "@/features/auth/lib/password-rules";
import {
  databaseHost,
  databaseProblem,
  generatePassword,
  parseResetPasswordArgs,
} from "@/features/auth/lib/reset-password-cli";

const DEV = "postgresql://user:secret@ep-flat-lake-1.neon.tech/neondb?sslmode=require";
const PROD = "postgresql://user:secret@ep-steep-sound-1.neon.tech/neondb?sslmode=require";

describe("parseResetPasswordArgs", () => {
  test("почта", () => {
    assert.deepEqual(parseResetPasswordArgs(["Ivan@Example.com"]), {
      email: "ivan@example.com",
      prod: false,
    });
  });

  test("почта и --prod в любом порядке", () => {
    const expected = { email: "ivan@example.com", prod: true };
    assert.deepEqual(parseResetPasswordArgs(["ivan@example.com", "--prod"]), expected);
    assert.deepEqual(parseResetPasswordArgs(["--prod", "ivan@example.com"]), expected);
  });

  test("пароль в командной строке не принимается", () => {
    const parsed = parseResetPasswordArgs(["ivan@example.com", "новый-пароль"]);
    assert.match("error" in parsed ? parsed.error : "", /не принимается/);
  });

  test("без почты, не почта, неизвестный флаг — отказ", () => {
    assert.ok("error" in parseResetPasswordArgs([]));
    assert.ok("error" in parseResetPasswordArgs(["ivan"]));
    assert.ok("error" in parseResetPasswordArgs(["ivan@example.com", "--force"]));
  });
});

describe("databaseProblem", () => {
  test("база не прод, без флага — можно", () => {
    assert.equal(databaseProblem([DEV, DEV], false), null);
  });

  test("прод без флага — отказ", () => {
    assert.match(databaseProblem([PROD, PROD], false) ?? "", /--prod/);
  });

  test("прод хотя бы в одной строке — отказ", () => {
    assert.match(databaseProblem([DEV, PROD], false) ?? "", /--prod/);
  });

  test("прод с флагом — можно", () => {
    assert.equal(databaseProblem([PROD, PROD], true), null);
  });

  test("флаг на базе, которая не прод, — отказ", () => {
    assert.match(databaseProblem([DEV], true) ?? "", /не прод/);
  });

  test("базы в .env нет — отказ", () => {
    assert.match(databaseProblem([undefined, ""], false) ?? "", /\.env/);
  });

  test("в тексте отказа нет строки подключения", () => {
    assert.ok(!(databaseProblem([PROD], false) ?? "").includes("secret"));
  });
});

describe("databaseHost", () => {
  test("только адрес, без пользователя и пароля", () => {
    assert.equal(databaseHost(DEV), "ep-flat-lake-1.neon.tech");
  });
});

describe("generatePassword", () => {
  test("проходит правила, каждый раз новый", () => {
    const first = generatePassword("ivan@example.com");
    assert.equal(passwordProblem(first, "ivan@example.com"), null);
    assert.equal(first.length, 24);
    assert.notEqual(first, generatePassword("ivan@example.com"));
  });
});
