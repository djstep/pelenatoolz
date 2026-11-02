import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Выгрузка на личный диск: порядок под блокировкой. Сама база здесь не поднимается —
 * проверяется код сервиса (как блокировка вызывного в `approval.test.ts`).
 */
const source = readFileSync(new URL("./drive-export-service.ts", import.meta.url), "utf8");

describe("выгрузка на личный диск — блокировка строки", () => {
  test("строка подключения под FOR UPDATE до поиска прежней выгрузки и записи", () => {
    const lock = source.search(/SELECT "id" FROM "CloudConnection" WHERE "id" = \$\{conn\.id\} FOR UPDATE/);
    const findExisting = source.indexOf("tx.driveExport.findFirst(");
    const write = source.indexOf("tx.driveExport.upsert(");
    assert.ok(lock > 0, "нет SELECT … FOR UPDATE по подключению");
    assert.ok(lock < findExisting && findExisting < write);
  });

  test("токен берётся до транзакции: обновление токена пишет в ту же строку", () => {
    assert.ok(source.indexOf("getValidAccessToken(conn.id, userId)") < source.indexOf("prisma.$transaction("));
  });

  test("время: транзакция ≤ 60 с, предел ожидания диска меньше её; lock_timeout до блокировки", () => {
    const tx = Number(/const TX_TIMEOUT_MS = ([\d_]+);/.exec(source)?.[1].replace(/_/g, ""));
    const deadline = Number(/const DEADLINE_MS = ([\d_]+);/.exec(source)?.[1].replace(/_/g, ""));
    assert.ok(tx > 5_000 && tx <= 60_000, `таймаут транзакции ${tx}`);
    assert.ok(deadline < tx, "предел ожидания диска должен быть меньше таймаута транзакции");
    assert.match(source, /timeout: TX_TIMEOUT_MS/);
    assert.ok(source.indexOf("SET LOCAL lock_timeout") < source.indexOf("WHERE \"id\" = ${conn.id} FOR UPDATE"));
    // Запросы к диску идут через предел, а не ждутся до него.
    assert.match(source, /put = await beforeDeadline\(\s*provider === "GOOGLE_DRIVE"\s*\? putCallSheetToGoogle/);
  });

  test("предел вышел — запись выгрузки не делается, папки после предела не пишутся", () => {
    const deadlineBranch = source.indexOf("if (e instanceof DriveDeadlineError)");
    const write = source.indexOf("tx.driveExport.upsert(");
    assert.ok(deadlineBranch > 0 && deadlineBranch < write);
    assert.match(source, /closed = true;\s*return \{ failure: e \};/);
    assert.match(source, /save: async \(key, folder\) => \{\s*if \(closed\) return;/);
  });

  test("папки и выгрузки — только своего подключения и этого проекта", () => {
    assert.match(source, /tx\.driveFolder\.findMany\(\{\s*where: \{ cloudConnectionId: conn\.id, projectId \}/);
    assert.match(source, /folder: \{ cloudConnectionId: conn\.id, projectId, key: DRIVE_FOLDER_KEYS\.callSheets \}/);
  });
});
