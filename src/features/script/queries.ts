import { SCENE_CHARACTER_SELECT } from "@/features/characters/lib/character-fields";
import { SCENE_LOCATION_SELECT } from "@/features/locations/lib/location-fields";
import { SCENE_RESOURCE_ITEM_SELECT } from "@/features/resources/lib/item-fields";
import { prisma } from "@/shared/db/prisma";
import { selectFields } from "@/shared/lib/finance-fields";

/**
 * Ресурс либретто — без устаревших `unitPrice` / `total` (деньги): либретто, карточка сцены
 * и сценарий уходят в браузер любой роли с правом на сцены, а цены нигде не показываются.
 */
export const LIBRETTO_SCENE_RESOURCE_SELECT = selectFields(["id", "sceneId", "category", "name", "quantity"]);

export async function listScenes(projectId: string) {
  return prisma.scene.findMany({
    where: { projectId },
    include: {
      locations: { include: { location: { select: SCENE_LOCATION_SELECT } } },
      characters: {
        include: {
          character: {
            select: {
              ...SCENE_CHARACTER_SELECT,
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
      resources: { select: LIBRETTO_SCENE_RESOURCE_SELECT },
      resourceItems: {
        include: {
          item: {
            select: {
              ...SCENE_RESOURCE_ITEM_SELECT,
              category: { select: { id: true, name: true } },
            },
          },
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
      shootAttempts: {
        include: {
          shootDay: {
            select: { id: true, dayNumber: true, unit: true },
          },
        },
        orderBy: [{ shootDate: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
  });
}

export async function getSceneForEdit(projectId: string, sceneId: string) {
  return prisma.scene.findFirst({
    where: { id: sceneId, projectId },
    include: {
      locations: { include: { location: { select: SCENE_LOCATION_SELECT } } },
      characters: { include: { character: { select: SCENE_CHARACTER_SELECT } } },
      elements: { include: { element: true } },
      resources: { select: LIBRETTO_SCENE_RESOURCE_SELECT },
      resourceItems: {
        include: {
          item: {
            select: {
              ...SCENE_RESOURCE_ITEM_SELECT,
              category: { select: { id: true, name: true } },
            },
          },
        },
      },
      shootAttempts: {
        include: {
          shootDay: {
            select: { id: true, dayNumber: true, unit: true },
          },
        },
        orderBy: [{ shootDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

/** Соседние сцены для стрелок — без вырезанных (кроме самой открытой сцены). */
export async function getSceneNeighbors(projectId: string, sceneId: string) {
  const scenes = await prisma.scene.findMany({
    where: { projectId, OR: [{ cutAt: null }, { id: sceneId }] },
    select: {
      id: true,
      episodeNumber: true,
      number: true,
      postfix: true,
    },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
  });
  const idx = scenes.findIndex((s) => s.id === sceneId);
  if (idx < 0) return { prev: null, next: null };
  return {
    prev: idx > 0 ? scenes[idx - 1]! : null,
    next: idx < scenes.length - 1 ? scenes[idx + 1]! : null,
  };
}

export async function listLocations(projectId: string) {
  return prisma.location.findMany({
    where: { projectId },
    select: SCENE_LOCATION_SELECT,
    orderBy: { name: "asc" },
  });
}

export async function listCharacters(projectId: string) {
  return prisma.character.findMany({
    where: { projectId },
    select: SCENE_CHARACTER_SELECT,
    orderBy: { name: "asc" },
  });
}

export async function listElements(projectId: string) {
  return prisma.element.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
}
