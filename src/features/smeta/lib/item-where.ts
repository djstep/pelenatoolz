import type { Prisma } from "@prisma/client";

/**
 * Действующая строка сметы: не в архиве сама, и (для сметы по статьям) не в архиве её подстатья
 * и статья. Запись старого табличного формата (без подстатьи) — по своей отметке архива.
 * Одно условие для выбора статей в начислениях и платежах и для итогов смет.
 */
export const ACTIVE_BUDGET_ITEM: Prisma.BudgetItemWhereInput = {
  archivedAt: null,
  OR: [{ subarticleId: null }, { subarticle: { archivedAt: null, article: { archivedAt: null } } }],
};

/** Строка в архиве — сама или через подстатью или статью. */
export function isItemArchived(row: {
  archivedAt: Date | null;
  subarticle: { archivedAt: Date | null; article: { archivedAt: Date | null } } | null;
}): boolean {
  return (
    row.archivedAt !== null ||
    (row.subarticle !== null &&
      (row.subarticle.archivedAt !== null || row.subarticle.article.archivedAt !== null))
  );
}
