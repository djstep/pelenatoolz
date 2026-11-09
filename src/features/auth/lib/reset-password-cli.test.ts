import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { passwordProblem } from "@/features/auth/lib/password-rules";
import {
  databaseHost,
  databaseProblem,
  generatePassword,
  parseResetPasswordArgs,
} from "@/features/auth/lib/reset-password-cli";

const DEV = "postgresql://user:secret@localhost:5432/pelena_dev";
/** Прод — база в Docker на сервере (служба `db`). */
const PROD = "postgresql://user:secret@db:5432/pelena";
const SERVER_PROD = PROD;

describe("parseResetPasswordArgs", () => {
  test("почта", () => {
    assert.deepEqual(parseResetPasswordArgs(["Ivan@Example.com"]), {
      email: "ivan@example.com",
      prod: false,
      envFile: ".env",
    });
  });

  test("почта и --prod в любом порядке", () => {
    const expected = { email: "ivan@example.com", prod: true, envFile: ".env" };
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

describe("parseResetPasswordArgs: --env-file", () => {
  const expected = { email: "ivan@example.com", prod: true, envFile: ".env.prod" };

  test("через пробел и через =, в любом месте", () => {
    assert.deepEqual(parseResetPasswordArgs(["ivan@example.com", "--env-file", ".env.prod", "--prod"]), expected);
    assert.deepEqual(parseResetPasswordArgs(["--env-file=.env.prod", "--prod", "ivan@example.com"]), expected);
  });

  test("путь не считается паролем", () => {
    const parsed = parseResetPasswordArgs(["ivan@example.com", "--env-file", "C:/secrets/.env.prod"]);
    assert.equal("error" in parsed ? "" : parsed.envFile, "C:/secrets/.env.prod");
  });

  test("без пути и дважды — отказ", () => {
    assert.ok("error" in parseResetPasswordArgs(["ivan@example.com", "--env-file"]));
    assert.ok("error" in parseResetPasswordArgs(["ivan@example.com", "--env-file="]));
    assert.ok("error" in parseResetPasswordArgs(["ivan@example.com", "--env-file", "--prod"]));
    assert.ok(
      "error" in parseResetPasswordArgs(["ivan@example.com", "--env-file", "a", "--env-file", "b"]),
    );
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

  test("прод на сервере: без флага отказ, с флагом можно", () => {
    assert.match(databaseProblem([SERVER_PROD], false) ?? "", /--prod/);
    assert.equal(databaseProblem([SERVER_PROD], true), null);
  });

  test("старый прод в облаке больше не прод: метки по имени хоста нет", () => {
    assert.equal(databaseProblem(["postgresql://user:secret@ep-old-prod.example/neondb"], false), null);
  });

  test("база с db в другом месте адреса не прод", () => {
    assert.equal(databaseProblem(["postgresql://db:secret@dev.example:5432/db"], false), null);
  });

  test("флаг на базе, которая не прод, — отказ", () => {
    assert.match(databaseProblem([DEV], true) ?? "", /не прод/);
  });

  test("базы в .env нет — отказ", () => {
    assert.match(databaseProblem([undefined, ""], false) ?? "", /\.env/);
  });

  test("в тексте отказа назван файл, с которым работали", () => {
    assert.match(databaseProblem([PROD], false, ".env.prod") ?? "", /\.env\.prod/);
    assert.match(databaseProblem([DEV], true, ".env.prod") ?? "", /\.env\.prod/);
    assert.match(databaseProblem([undefined], false, ".env.prod") ?? "", /\.env\.prod/);
  });

  test("есть только DIRECT_URL, без DATABASE_URL — отказ", () => {
    assert.match(databaseProblem([undefined, DEV], false) ?? "", /DATABASE_URL/);
  });

  test("в тексте отказа нет строки подключения", () => {
    assert.ok(!(databaseProblem([PROD], false) ?? "").includes("secret"));
  });
});

describe("databaseHost", () => {
  test("только адрес, без пользователя и пароля", () => {
    assert.equal(databaseHost(DEV), "localhost");
  });

  test("@ в пароле не сбивает: прод узнаётся, без --prod отказ", () => {
    const url = "postgresql://user:p@ss@db:5432/pelena";
    assert.equal(databaseHost(url), "db");
    assert.match(databaseProblem([url], false) ?? "", /--prod/);
  });

  test("неразборчивый адрес — «?»", () => {
    assert.equal(databaseHost("не адрес"), "?");
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
