import { prisma } from "@/shared/db/prisma";

const sceneDetailSelect = {
  id: true,
  number: true,
  postfix: true,
  episodeNumber: true,
  title: true,
  summary: true,
  scriptContent: true,
  planSeconds: true,
  pageCount: true,
  intExt: true,
  dayNight: true,
  status: true,
  scriptDay: true,
  locations: { include: { location: true } },
  characters: { include: { character: true } },
} as const;

export async function listShootDays(projectId: string) {
  return prisma.shootDay.findMany({
    where: { projectId },
    include: {
      scenes: {
        include: {
          scene: { select: sceneDetailSelect },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { dayNumber: "asc" },
  });
}

export async function listUnscheduledScenes(projectId: string) {
  return prisma.scene.findMany({
    where: {
      projectId,
      shootDayScenes: { none: {} },
      status: { not: "OFF_PLAN" },
    },
    select: sceneDetailSelect,
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
  });
}

export async function getScheduleStats(projectId: string) {
  const [days, assigned, totalScenes] = await Promise.all([
    prisma.shootDay.count({ where: { projectId } }),
    prisma.shootDayScene.count({
      where: { shootDay: { projectId } },
    }),
    prisma.scene.count({ where: { projectId } }),
  ]);
  return { days, assigned, totalScenes };
}
