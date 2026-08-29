import { prisma } from "@/shared/db/prisma";

export async function listActors(projectId: string) {
  return prisma.actor.findMany({
    where: { projectId },
    include: {
      character: true,
      overtimeRates: { orderBy: { hourNumber: "asc" } },
      extraPayments: { orderBy: { paymentDate: "asc" } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}
