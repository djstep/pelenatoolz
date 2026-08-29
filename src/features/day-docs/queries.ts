import { prisma } from "@/shared/db/prisma";

const sceneSelect = {
  id: true,
  number: true,
  postfix: true,
  episodeNumber: true,
  title: true,
  summary: true,
  planSeconds: true,
  pageCount: true,
  intExt: true,
  dayNight: true,
  status: true,
  scriptDay: true,
  locations: { include: { location: true } },
  characters: { include: { character: true } },
  resources: true,
  elements: { include: { element: true } },
} as const;

const shootDayInclude = {
  scenes: {
    include: { scene: { select: sceneSelect } },
    orderBy: { sortOrder: "asc" as const },
  },
  departmentCalls: { orderBy: { sortOrder: "asc" as const } },
  transports: { orderBy: { sortOrder: "asc" as const } },
  timeSlots: {
    include: { scene: { select: sceneSelect } },
    orderBy: { sortOrder: "asc" as const },
  },
  actorCalls: true,
  resourceCalls: true,
} as const;

export async function getShootDayDocument(projectId: string, shootDayId: string) {
  const [project, day, actors] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        fullName: true,
        city: true,
        timezone: true,
        currency: true,
      },
    }),
    prisma.shootDay.findFirst({
      where: { id: shootDayId, projectId },
      include: shootDayInclude,
    }),
    prisma.actor.findMany({
      where: { projectId },
      include: { character: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  if (!project || !day) return null;

  return { project, day, actors };
}

export async function getNextShootDayBrief(
  projectId: string,
  afterDayNumber: number,
) {
  const next = await prisma.shootDay.findFirst({
    where: {
      projectId,
      dayNumber: { gt: afterDayNumber },
      dayType: "WORKING",
    },
    orderBy: { dayNumber: "asc" },
    include: {
      scenes: {
        include: {
          scene: {
            select: {
              number: true,
              postfix: true,
              episodeNumber: true,
              dayNight: true,
              locations: { include: { location: true } },
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return next;
}

export async function listShootDaysBrief(projectId: string) {
  return prisma.shootDay.findMany({
    where: { projectId },
    select: {
      id: true,
      dayNumber: true,
      date: true,
      dayType: true,
      status: true,
      callTime: true,
      wrapTime: true,
      isNightShift: true,
      isLocked: true,
      _count: { select: { scenes: true } },
    },
    orderBy: { dayNumber: "asc" },
  });
}
