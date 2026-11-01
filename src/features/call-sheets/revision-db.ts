import "server-only";

import type { Tx } from "@/features/call-sheets/queries";
import {
  runWithRevision,
  type ExpectedRevision,
  type LockedCallSheet,
  type RevisionDb,
} from "@/features/call-sheets/lib/revision";
import { prisma } from "@/shared/db/prisma";

/** Строка вызывного дня под блокировкой до конца транзакции (`SELECT … FOR UPDATE`). */
export async function lockCallSheetRow(
  tx: Tx,
  projectId: string,
  shootDayId: string,
): Promise<LockedCallSheet | null> {
  const rows = await tx.$queryRaw<LockedCallSheet[]>`
    SELECT "id", "status"::text AS "status", "version", "revision"
    FROM "CallSheet"
    WHERE "shootDayId" = ${shootDayId} AND "projectId" = ${projectId}
    FOR UPDATE`;
  return rows[0] ?? null;
}

function revisionDb(tx: Tx, projectId: string): RevisionDb {
  return {
    lockCallSheet: (shootDayId) => lockCallSheetRow(tx, projectId, shootDayId),
    setRevision: async (id, revision) => {
      await tx.callSheet.update({ where: { id }, data: { revision } });
    },
  };
}

/**
 * Все записи вызывного и данных дня из вызывного идут через эту функцию: сверка номера
 * правки и +1 — первым делом в той же транзакции, что и запись (`lib/revision.ts`).
 * Отказ — исключение `CallSheetEditRefused`, его ловит действие.
 */
export function withCallSheetRevision<T>(
  projectId: string,
  shootDayId: string,
  expected: ExpectedRevision,
  write: (tx: Tx) => Promise<T>,
): Promise<{ result: T; revision: number | null }> {
  return runWithRevision<Tx, T>(
    // «Обновить из КПП» и пересчёт таймингов пишут построчно — запас на долгую транзакцию.
    (fn) => prisma.$transaction(fn, { timeout: 15_000 }),
    (tx) => revisionDb(tx, projectId),
    shootDayId,
    expected,
    write,
  );
}
