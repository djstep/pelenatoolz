import { prisma } from "@/shared/db/prisma";
import { serializeForClient } from "@/shared/db/serialize-decimal";
import {
  computeActorTimingBaselines,
  computeResourceTimingBaselines,
  type ActorTimingBaselines,
  type ResourceTimingBaselines,
} from "@/features/day-docs/lib/compute-call-timings";

export type { ActorTimingBaselines, ResourceTimingBaselines };

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
  resourceItems: {
    include: {
      item: {
        include: {
          category: { select: { id: true, name: true, perShift: true } },
        },
      },
    },
  },
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
  resourceUsages: {
    include: {
      item: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              perShift: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  },
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

  return serializeForClient({ project, day, actors });
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

export async function getActorTimingBaselines(
  projectId: string,
  shootDayId: string,
): Promise<ActorTimingBaselines> {
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: {
      timeSlots: { orderBy: { sortOrder: "asc" } },
      scenes: {
        include: {
          scene: {
            select: {
              id: true,
              characters: { select: { characterId: true } },
            },
          },
        },
      },
    },
  });
  if (!day || day.timeSlots.length === 0) return {};

  const characterIds = new Set<string>();
  const sceneCharacters: Array<{ sceneId: string; characterId: string }> = [];
  for (const row of day.scenes) {
    for (const link of row.scene.characters) {
      characterIds.add(link.characterId);
      sceneCharacters.push({
        sceneId: row.scene.id,
        characterId: link.characterId,
      });
    }
  }
  if (characterIds.size === 0) return {};

  const [actors, characters] = await Promise.all([
    prisma.actor.findMany({
      where: { projectId, characterId: { in: [...characterIds] } },
      select: {
        id: true,
        characterId: true,
        pickupOffsetMin: true,
        lastName: true,
        firstName: true,
        middleName: true,
      },
    }),
    prisma.character.findMany({
      where: { id: { in: [...characterIds] } },
      select: {
        id: true,
        makeupOffsetMin: true,
        costumeOffsetMin: true,
      },
    }),
  ]);

  return computeActorTimingBaselines({
    timeSlots: day.timeSlots,
    sceneCharacters,
    actors: actors.map((a) => ({
      id: a.id,
      characterId: a.characterId,
      pickupOffsetMin: a.pickupOffsetMin,
      label: [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" "),
    })),
    characters,
  });
}

export async function getResourceTimingBaselines(
  projectId: string,
  shootDayId: string,
): Promise<ResourceTimingBaselines> {
  const day = await prisma.shootDay.findFirst({
    where: { id: shootDayId, projectId },
    include: {
      timeSlots: { orderBy: { sortOrder: "asc" } },
      scenes: {
        include: {
          scene: {
            select: {
              id: true,
              resources: { select: { category: true, name: true } },
              elements: {
                select: {
                  element: { select: { name: true, type: true } },
                },
              },
              resourceItems: {
                select: {
                  quantity: true,
                  item: {
                    select: {
                      name: true,
                      category: { select: { name: true, perShift: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!day || day.timeSlots.length === 0) return {};

  return computeResourceTimingBaselines({
    timeSlots: day.timeSlots,
    dayScenes: day.scenes,
    shiftStartTime: day.shiftStartTime,
    callTime: day.callTime,
  });
}
