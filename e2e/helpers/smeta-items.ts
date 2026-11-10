import type { PrismaClient } from "@prisma/client";

/**
 * Смета цеха по статьям прямо в базе — для тестов выгрузок: статья шаблона (с меткой прогона
 * в названии), статья цеха, подстатья и строка. Удаляется `deleteItemsRun` по той же метке.
 */
export async function createItemsLine(
  db: PrismaClient,
  input: {
    projectId: string;
    departmentId: string;
    budgetId: string;
    run: string;
    line: { name: string; unit: string; quantity: number; rate: number; taxPercent: number };
  },
) {
  const { projectId, departmentId, budgetId, run, line } = input;
  const settings = await db.projectBudgetSettings.upsert({
    where: { projectId },
    create: { projectId, lastTemplateArticleNumber: 1 },
    update: { lastTemplateArticleNumber: { increment: 1 } },
  });
  const number = settings.lastTemplateArticleNumber;
  const template = await db.budgetTemplateArticle.create({
    data: { projectId, number, name: `Транспорт ${run}`, sortOrder: 900 + (number % 100) },
    select: { id: true },
  });
  const article = await db.budgetArticle.create({
    data: { projectId, budgetId, templateArticleId: template.id, lastSubarticleNumber: 1 },
    select: { id: true },
  });
  const sub = await db.budgetSubarticle.create({
    data: { projectId, articleId: article.id, number: 1, name: `Спецтранспорт ${run}`, lastLineNumber: 1 },
    select: { id: true },
  });
  const { codePrefix } = await db.department.findUniqueOrThrow({ where: { id: departmentId }, select: { codePrefix: true } });
  const two = (n: number) => String(n).padStart(2, "0");
  const code = `${codePrefix}-${two(number)}.01.01`;
  const amount = Math.round(line.quantity * line.rate * 100) / 100;
  const tax = Math.round(amount * line.taxPercent) / 100;
  const item = await db.budgetItem.create({
    data: {
      projectId,
      departmentId,
      subarticleId: sub.id,
      number: 1,
      code,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      rate: line.rate,
      taxPercent: line.taxPercent,
      amount,
      tax,
      total: amount + tax,
    },
    select: { id: true },
  });
  return {
    templateArticleId: template.id,
    articleId: article.id,
    subarticleId: sub.id,
    itemId: item.id,
    code,
    articleCode: `${codePrefix}-${two(number)}`,
    total: amount + tax,
  };
}

/** Убрать всё, что создано `createItemsLine` (и импортом в эти статьи) с меткой прогона. */
export async function deleteItemsRun(db: PrismaClient, projectId: string, run: string) {
  const runArticles = { projectId, templateArticle: { name: { contains: run } } };
  await db.budgetItem.deleteMany({ where: { projectId, subarticle: { article: runArticles } } });
  await db.budgetSubarticle.deleteMany({ where: { projectId, article: runArticles } });
  await db.budgetArticle.deleteMany({ where: runArticles });
  await db.budgetTemplateArticle.deleteMany({ where: { projectId, name: { contains: run } } });
}
