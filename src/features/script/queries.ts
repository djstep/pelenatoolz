import { prisma } from "@/shared/db/prisma";

export async function listScenes(projectId: string) {
  return prisma.scene.findMany({
    where: { projectId },
    include: {
      locations: { include: { location: true } },
      characters: {
        include: {
          character: {
            include: {
              actors: {
                select: {
                  id: true,
                  lastName: true,
                  firstName: true,
                  middleName: true,
                },
              },
            },
          },
        },
      },
      elements: { include: { element: true } },
      resources: true,
      resourceItems: {
        include: {
          item: { include: { category: { select: { id: true, name: true } } } },
        },
      },
      shootDayScenes: {
        include: {
          shootDay: {
            select: {
              id: true,
              date: true,
              dayNumber: true,
              unit: true,
            },
          },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
  });
}

export async function getSceneForEdit(projectId: string, sceneId: string) {
  return prisma.scene.findFirst({
    where: { id: sceneId, projectId },
    include: {
      locations: { include: { location: true } },
      characters: { include: { character: true } },
      elements: { include: { element: true } },
      resources: true,
      resourceItems: {
        include: {
          item: { include: { category: { select: { id: true, name: true } } } },
        },
      },
    },
  });
}

export async function listLocations(projectId: string) {
  return prisma.location.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}

export async function listCharacters(projectId: string) {
  return prisma.character.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}

export async function listElements(projectId: string) {
  return prisma.element.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}

export async function getScriptStats(projectId: string) {
  const [scenes, locations, characters, elements] = await Promise.all([
    prisma.scene.count({ where: { projectId } }),
    prisma.location.count({ where: { projectId } }),
    prisma.character.count({ where: { projectId } }),
    prisma.element.count({ where: { projectId } }),
  ]);
  return { scenes, locations, characters, elements };
}
