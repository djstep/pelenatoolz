import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { seedDatabaseProblem } from "@/shared/db/seed-database-guard";

const url = (host: string) => `postgresql://user:secret@${host}/neondb?sslmode=require`;

const DEV = "ep-floral-bread-zabr5sop.c-2.eu-west-2.aws.neon.tech";
const DEV_POOLER = "ep-floral-bread-zabr5sop-pooler.c-2.eu-west-2.aws.neon.tech";
const E2E_BRANCH = "ep-wispy-unit-za418ey3.c-2.eu-west-2.aws.neon.tech";

describe("сид: только перечисленные тестовые базы", () => {
  test("dev и e2e-ветка: прямой адрес и адрес через пул", () => {
    assert.equal(seedDatabaseProblem({ DATABASE_URL: url(DEV_POOLER), DIRECT_URL: url(DEV) }), null);
    assert.equal(seedDatabaseProblem({ DATABASE_URL: url(E2E_BRANCH), DIRECT_URL: url(E2E_BRANCH) }), null);
  });

  test("DIRECT_URL может не быть", () => {
    assert.equal(seedDatabaseProblem({ DATABASE_URL: url(DEV) }), null);
  });

  test("прод, будущий VPS и локальная база — отказ с именем сервера", () => {
    for (const host of [
      "ep-steep-sound-abc123.c-2.eu-west-2.aws.neon.tech",
      "db.pelena.example.ru",
      "localhost",
      "127.0.0.1",
    ]) {
      const problem = seedDatabaseProblem({ DATABASE_URL: url(host) });
      assert.ok(problem?.includes(host), host);
      assert.ok(problem?.includes("не в списке тестовых баз"));
    }
  });

  test("хватает одной чужой строки", () => {
    const problem = seedDatabaseProblem({ DATABASE_URL: url(DEV), DIRECT_URL: url("db.pelena.example.ru") });
    assert.ok(problem?.includes("DIRECT_URL"));
  });

  test("имя базы из списка важно только как имя сервера", () => {
    const cases = [
      // в пароле, пути и параметрах
      "postgresql://user:ep-floral-bread-zabr5sop@db.pelena.example.ru/neondb",
      `postgresql://user:secret@db.pelena.example.ru/${DEV}`,
      `postgresql://user:secret@db.pelena.example.ru/neondb?host=${DEV}`,
      // в чужом домене
      url(`${DEV}.evil.example`),
      url("ep-floral-bread-zabr5sop.example.ru"),
      url("ep-floral-bread-zabr5sop-other.c-2.eu-west-2.aws.neon.tech"),
    ];
    for (const value of cases) {
      assert.notEqual(seedDatabaseProblem({ DATABASE_URL: value }), null, value);
    }
  });

  test("пусто или не адрес — отказ; пароля в тексте нет", () => {
    assert.ok(seedDatabaseProblem({})?.includes("DATABASE_URL"));
    assert.ok(seedDatabaseProblem({ DATABASE_URL: "" })?.includes("DATABASE_URL"));
    const problem = seedDatabaseProblem({ DATABASE_URL: "не адрес secret" });
    assert.ok(problem?.includes("не удалось разобрать"));
    assert.ok(!problem?.includes("secret"));
    assert.ok(!seedDatabaseProblem({ DATABASE_URL: url("db.pelena.example.ru") })?.includes("secret"));
  });
});
