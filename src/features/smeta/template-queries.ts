import "server-only";

import { prisma } from "@/shared/db/prisma";

export type TemplateArticleRow = {
  id: string;
  name: string;
  archived: boolean;
  /** Сколько цехов взяли статью: такую статью можно только убрать в архив. */
  departmentCount: number;
};

/**
 * Статьи общего шаблона сметы фильма: сначала действующие по порядку, затем архив.
 * Номер статьи внутренний (часть кода строки) — на экран не отдаётся.
 */
export async function listTemplateArticles(projectId: string): Promise<TemplateArticleRow[]> {
  const rows = await prisma.budgetTemplateArticle.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { articles: true } },
    },
  });
  const list = rows.map((r) => ({
    id: r.id,
    name: r.name,
    archived: r.archivedAt !== null,
    departmentCount: r._count.articles,
  }));
  return [...list.filter((r) => !r.archived), ...list.filter((r) => r.archived)];
}
