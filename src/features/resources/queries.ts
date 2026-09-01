import { prisma } from "@/shared/db/prisma";
import { dec } from "@/shared/db/serialize-decimal";

export async function listResourceCategoriesForScenes(projectId: string) {
  return prisma.resourceCategory.findMany({
    where: { projectId, fillInScenes: true },
    include: {
      items: {
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listResourceCategories(projectId: string) {
  return prisma.resourceCategory.findMany({
    where: { projectId },
    include: {
      _count: { select: { items: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getResourceCategory(projectId: string, categoryId: string) {
  return prisma.resourceCategory.findFirst({
    where: { id: categoryId, projectId },
    include: {
      items: {
        include: {
          _count: { select: { sceneLinks: true } },
          sceneLinks: {
            include: {
              scene: {
                select: {
                  id: true,
                  episodeNumber: true,
                  number: true,
                  postfix: true,
                  status: true,
                  planSeconds: true,
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });
}

export async function getResourceItem(
  projectId: string,
  categoryId: string,
  itemId: string,
) {
  const item = await prisma.resourceItem.findFirst({
    where: { id: itemId, categoryId, category: { projectId } },
    include: {
      category: true,
      sceneLinks: {
        include: {
          scene: {
            select: {
              id: true,
              episodeNumber: true,
              number: true,
              postfix: true,
              status: true,
              planSeconds: true,
              factSeconds: true,
            },
          },
        },
      },
    },
  });

  if (!item) return null;

  const planSeconds = item.sceneLinks.reduce(
    (sum, link) => sum + (link.scene.planSeconds ?? 0),
    0,
  );
  const unshotLinks = item.sceneLinks.filter(
    (l) => l.scene.status !== "SHOT",
  );
  const unshotSeconds = unshotLinks.reduce(
    (sum, link) => sum + (link.scene.planSeconds ?? 0),
    0,
  );

  return {
    ...item,
    shiftRate: dec(item.shiftRate),
    sceneCount: item.sceneLinks.length,
    unshotSceneCount: unshotLinks.length,
    planSeconds,
    unshotSeconds,
  };
}

export type ResourceCategoryRow = Awaited<
  ReturnType<typeof listResourceCategories>
>[number];

export type ResourceCategoryDetail = NonNullable<
  Awaited<ReturnType<typeof getResourceCategory>>
>;

export type ResourceItemDetail = NonNullable<
  Awaited<ReturnType<typeof getResourceItem>>
>;
