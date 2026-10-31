import { prisma } from "@/shared/db/prisma";

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;
type Tx = TransactionCallback extends (client: infer T) => Promise<unknown> ? T : never;
/** Клиент базы или транзакция. */
type Db = Pick<Tx, "audition">;

/**
 * Удаление проб — одно для «Удалить пробу» и удаления кандидата. Участники пробы
 * удаляются вместе с ней; видео остаётся в «Файлах проекта» (удаляется только там).
 */
export async function deleteAuditions(
  db: Db,
  projectId: string,
  auditionIds: string[],
): Promise<number> {
  if (auditionIds.length === 0) return 0;
  const { count } = await db.audition.deleteMany({
    where: { id: { in: auditionIds }, projectId },
  });
  return count;
}
