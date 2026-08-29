import { prisma } from "@/shared/db/prisma";

export async function listPostTasks(projectId: string) {
  return prisma.postTask.findMany({
    where: { projectId },
    orderBy: [{ stage: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export async function getPostPipelineStats(projectId: string) {
  const tasks = await listPostTasks(projectId);
  const byStatus = {
    TODO: 0,
    IN_PROGRESS: 0,
    DONE: 0,
    BLOCKED: 0,
  };
  for (const t of tasks) {
    byStatus[t.status] += 1;
  }
  return { total: tasks.length, ...byStatus };
}
