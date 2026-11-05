import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  e2eDatabaseEnvProblem,
  e2eDatabaseProblem,
  resolveE2EDatabaseEnv,
} from "@/shared/db/e2e-database-guard";

const url = (host: string) => `postgresql://user:secret@${host}/neondb?sslmode=require`;

const E2E = "ep-wispy-unit-za418ey3.c-2.eu-west-2.aws.neon.tech";
const E2E_POOLER = "ep-wispy-unit-za418ey3-pooler.c-2.eu-west-2.aws.neon.tech";
const DEV = "ep-floral-bread-zabr5sop.c-2.eu-west-2.aws.neon.tech";
const DEV_POOLER = "ep-floral-bread-zabr5sop-pooler.c-2.eu-west-2.aws.neon.tech";

const e2eUrls = { E2E_DATABASE_URL: url(E2E_POOLER), E2E_DIRECT_URL: url(E2E) };
const appUrls = { DATABASE_URL: url(DEV_POOLER), DIRECT_URL: url(DEV) };

describe("база e2e: e2eDatabaseProblem", () => {
  test("своя база из списка: прямой адрес и адрес через пул", () => {
    assert.equal(e2eDatabaseProblem(e2eUrls, appUrls), null);
  });

  test("нет переменных: отказ с именем переменной, без отката на .env", () => {
    for (const [e2e, name] of [
      [{}, "E2E_DATABASE_URL"],
      [{ E2E_DATABASE_URL: url(E2E_POOLER) }, "E2E_DIRECT_URL"],
      [{ E2E_DATABASE_URL: "", E2E_DIRECT_URL: url(E2E) }, "E2E_DATABASE_URL"],
      [{ E2E_DATABASE_URL: url(E2E_POOLER), E2E_DIRECT_URL: "" }, "E2E_DIRECT_URL"],
    ] as const) {
      const problem = e2eDatabaseProblem(e2e, appUrls);
      assert.ok(problem?.includes(`нет ${name}`), problem ?? "нет отказа");
    }
  });

  test("чужой хост: отказ в обеих переменных, в тексте только имя сервера", () => {
    for (const host of [
      DEV,
      DEV_POOLER,
      "ep-steep-sound-abc123.c-2.eu-west-2.aws.neon.tech",
      "ep-wispy-unit-za418ey3-copy.c-2.eu-west-2.aws.neon.tech",
      "xep-wispy-unit-za418ey3.c-2.eu-west-2.aws.neon.tech",
      "ep-wispy-unit-za418ey3.evil.example.com",
      "localhost",
    ]) {
      for (const urls of [
        { ...e2eUrls, E2E_DATABASE_URL: url(host) },
        { ...e2eUrls, E2E_DIRECT_URL: url(host) },
      ]) {
        const problem = e2eDatabaseProblem(urls, appUrls);
        assert.ok(problem?.includes(host), problem ?? `нет отказа: ${host}`);
        assert.ok(!problem?.includes("secret"), problem ?? "");
      }
    }
  });

  test("адрес не разбирается: отказ, строка не попадает в текст", () => {
    const problem = e2eDatabaseProblem({ ...e2eUrls, E2E_DATABASE_URL: "не адрес secret" }, appUrls);
    assert.ok(problem?.includes("E2E_DATABASE_URL"), problem ?? "нет отказа");
    assert.ok(!problem?.includes("secret"), problem ?? "");
  });

  test("та же база в .env: отказ", () => {
    const problem = e2eDatabaseProblem(e2eUrls, { DATABASE_URL: url(E2E) });
    assert.ok(problem?.includes("совпадает с DATABASE_URL"), problem ?? "нет отказа");
  });

  test("в .env та же база, разница только в -pooler: отказ в обе стороны", () => {
    for (const app of [
      { DATABASE_URL: url(E2E_POOLER) },
      { DATABASE_URL: url(E2E) },
      { DATABASE_URL: url(DEV_POOLER), DIRECT_URL: url(E2E_POOLER) },
      { DATABASE_URL: url(DEV_POOLER), DIRECT_URL: url(E2E) },
    ]) {
      assert.ok(e2eDatabaseProblem(e2eUrls, app)?.includes("совпадает"), JSON.stringify(app));
    }
  });

  test("адрес в .env не разбирается: отказ, сравнить нельзя", () => {
    const problem = e2eDatabaseProblem(e2eUrls, { DATABASE_URL: "не адрес secret" });
    assert.ok(problem?.includes(".env"), problem ?? "нет отказа");
    assert.ok(!problem?.includes("secret"), problem ?? "");
  });

  test("в .env нет базы: сравнивать не с чем, отказа нет", () => {
    assert.equal(e2eDatabaseProblem(e2eUrls, {}), null);
  });
});

describe("база e2e: e2eDatabaseEnvProblem", () => {
  const expected = { DATABASE_URL: url(E2E_POOLER), DIRECT_URL: url(E2E) };

  test("адреса на месте: отказа нет", () => {
    assert.equal(e2eDatabaseEnvProblem({ ...expected }, expected), null);
  });

  test(".env перетёр любой из адресов или адрес пропал: отказ без адресов в тексте", () => {
    for (const [current, name] of [
      [{ ...expected, DATABASE_URL: url(DEV_POOLER) }, "DATABASE_URL"],
      [{ ...expected, DIRECT_URL: url(DEV) }, "DIRECT_URL"],
      [{ DIRECT_URL: url(E2E) }, "DATABASE_URL"],
    ] as const) {
      const problem = e2eDatabaseEnvProblem(current, expected);
      assert.ok(problem?.includes(name), problem ?? "нет отказа");
      assert.ok(!problem?.includes("secret"), problem ?? "");
      assert.ok(!problem?.includes("neon.tech"), problem ?? "");
    }
  });
});

describe("база e2e: resolveE2EDatabaseEnv", () => {
  function withFiles<T>(files: Record<string, string>, run: (root: string) => T): T {
    const root = mkdtempSync(path.join(tmpdir(), "e2e-database-"));
    try {
      for (const [name, content] of Object.entries(files)) writeFileSync(path.join(root, name), content);
      return run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  const envE2E = `E2E_DATABASE_URL="${url(E2E_POOLER)}"\nE2E_DIRECT_URL=${url(E2E)}\n`;

  test("адреса из .env.e2e становятся DATABASE_URL и DIRECT_URL", () => {
    withFiles({ ".env.e2e": envE2E, ".env": `DATABASE_URL="${url(DEV_POOLER)}"\n` }, (root) => {
      assert.deepEqual(resolveE2EDatabaseEnv(root), { DATABASE_URL: url(E2E_POOLER), DIRECT_URL: url(E2E) });
    });
  });

  test("нет .env.e2e или нет в нём адресов: отказ, DATABASE_URL из файлов не подхватывается", () => {
    const app = `DATABASE_URL="${url(E2E_POOLER)}"\nDIRECT_URL="${url(E2E)}"\n`;
    withFiles({ ".env": app }, (root) => {
      assert.throws(() => resolveE2EDatabaseEnv(root), /нет E2E_DATABASE_URL/);
    });
    withFiles({ ".env.e2e": app }, (root) => {
      assert.throws(() => resolveE2EDatabaseEnv(root), /нет E2E_DATABASE_URL/);
    });
  });

  test("та же база в .env: отказ", () => {
    withFiles({ ".env.e2e": envE2E, ".env": `DATABASE_URL="${url(E2E)}"\n` }, (root) => {
      assert.throws(() => resolveE2EDatabaseEnv(root), /совпадает/);
    });
  });
});
