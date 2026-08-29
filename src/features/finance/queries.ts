import { prisma } from "@/shared/db/prisma";

export async function listFinanceOperations(projectId: string) {
  return prisma.financeOperation.findMany({
    where: { projectId },
    include: {
      actor: {
        select: {
          id: true,
          lastName: true,
          firstName: true,
          middleName: true,
        },
      },
    },
    orderBy: [{ operationDate: "desc" }, { createdAt: "desc" }],
  });
}

export async function listActorsBrief(projectId: string) {
  return prisma.actor.findMany({
    where: { projectId },
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
      shiftRate: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

export async function getFinanceSummary(projectId: string) {
  const ops = await prisma.financeOperation.findMany({
    where: { projectId },
    select: { type: true, amount: true },
  });
  let income = 0;
  let expense = 0;
  for (const op of ops) {
    const amount = Number(op.amount);
    if (op.type === "INCOME") income += amount;
    else expense += amount;
  }
  return { income, expense, balance: income - expense, count: ops.length };
}
