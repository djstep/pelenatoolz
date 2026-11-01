import "server-only";

import type { Tx } from "@/features/call-sheets/queries";
import { ensureSectionsIn } from "@/features/call-sheets/lib/sections";

/**
 * Создаёт недостающие системные разделы элементов площадки проекта (групповка, реквизит…).
 * Вызывать внутри транзакции записи (сохранение разделов, элементов, «Создать вызывной»).
 * Идемпотентно и устойчиво к одновременному вызову: unique [projectId, key] + skipDuplicates.
 * Открытие страниц это не вызывает — там разделы по умолчанию показываются из кода.
 */
export async function ensureCallSheetSections(
  tx: Pick<Tx, "callSheetSection">,
  projectId: string,
): Promise<void> {
  await ensureSectionsIn(
    {
      list: () =>
        tx.callSheetSection.findMany({
          where: { projectId },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, key: true, sortOrder: true },
        }),
      setSortOrders: async (rows) => {
        for (const row of rows) {
          await tx.callSheetSection.update({
            where: { id: row.id },
            data: { sortOrder: row.sortOrder },
          });
        }
      },
      createManySkipDuplicates: async (rows) =>
        (await tx.callSheetSection.createMany({ data: rows, skipDuplicates: true })).count,
    },
    projectId,
  );
}
