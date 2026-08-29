import { prisma } from "@/shared/db/prisma";

export async function listBudgetLines(projectId: string) {
  return prisma.budgetLine.findMany({
    where: { projectId },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function getBudgetTotals(projectId: string) {
  const lines = await listBudgetLines(projectId);
  let planned = 0;
  let actual = 0;
  for (const line of lines) {
    planned += Number(line.planned);
    actual += Number(line.actual);
  }
  return { planned, actual, variance: planned - actual, count: lines.length };
}
