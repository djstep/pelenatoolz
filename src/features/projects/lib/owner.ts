import type { Prisma } from "@prisma/client";

/** Отказ при попытке понизить, удалить или переназначить владельца проекта. */
export const OWNER_PROTECTED_ERROR = "Это владелец проекта — сначала передайте владение";

/** Отказ при правке или удалении роли, которая назначена владельцу. */
export const OWNER_ROLE_ERROR = "Эта роль назначена владельцу проекта — сначала передайте владение";

export const OWNER_ONLY_TRANSFER_ERROR = "Передать владение может только владелец проекта";
export const OWNER_ONLY_DELETE_ERROR = "Удалить проект может только его владелец";
export const TRANSFER_TO_PRODUCER_ERROR =
  "Владение можно передать только участнику с ролью «Продюсер»";

type LockDb = { $queryRaw: Prisma.TransactionClient["$queryRaw"] };

/**
 * Блокирует строку проекта до конца транзакции и возвращает владельца.
 * Всё, что меняет владельца или участников-продюсеров, идёт под этой блокировкой:
 * двойной клик и вторая вкладка выполняются по очереди и видят результат первой.
 */
export async function lockProjectOwner(
  tx: LockDb,
  projectId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ ownerUserId: string }[]>`
    SELECT "ownerUserId" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
  return rows[0]?.ownerUserId ?? null;
}
