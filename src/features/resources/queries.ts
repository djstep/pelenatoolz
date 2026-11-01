import { prisma } from "@/shared/db/prisma";
import { pickFinanceFields } from "@/shared/lib/finance-fields";
import { RESOURCE_ITEM_FIELDS } from "@/features/resources/lib/item-fields";
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

/** `canFinanceRead` — фин. просмотр категории (`ctx.canFinanceRead({ categoryId })`). */
export async function getResourceCategory(
  projectId: string,
  categoryId: string,
  canFinanceRead: boolean,
) {
  const category = await prisma.resourceCategory.findFirst({
    where: { id: categoryId, projectId },
    include: {
      items: {
        include: {
          overtimeRates: { orderBy: { hourNumber: "asc" } },
          extraPayments: { orderBy: { paymentDate: "asc" } },
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
                  cutAt: true,
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!category) return null;
  return {
    ...category,
    items: category.items.map((item) =>
      pickFinanceFields(item, RESOURCE_ITEM_FIELDS, canFinanceRead),
    ),
  };
}

export async function getResourceItem(
  projectId: string,
  categoryId: string,
  itemId: string,
  canFinanceRead: boolean,
) {
  const item = await prisma.resourceItem.findFirst({
    where: { id: itemId, categoryId, category: { projectId } },
    include: {
      category: true,
      overtimeRates: { orderBy: { hourNumber: "asc" } },
      extraPayments: { orderBy: { paymentDate: "asc" } },
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
              cutAt: true,
            },
          },
        },
      },
    },
  });

  if (!item) return null;

  // Хронометраж — без вырезанных сцен
  const planSeconds = item.sceneLinks.reduce(
    (sum, link) => sum + (link.scene.cutAt ? 0 : (link.scene.planSeconds ?? 0)),
    0,
  );
  const unshotLinks = item.sceneLinks.filter(
    (l) => l.scene.status !== "SHOT",
  );
  const unshotSeconds = unshotLinks.reduce(
    (sum, link) => sum + (link.scene.cutAt ? 0 : (link.scene.planSeconds ?? 0)),
    0,
  );

  return pickFinanceFields(
    {
      ...item,
      shiftRate: dec(item.shiftRate),
      taxPercent: dec(item.taxPercent),
      kmRate: dec(item.kmRate),
      sceneCount: item.sceneLinks.length,
      unshotSceneCount: unshotLinks.length,
      planSeconds,
      unshotSeconds,
    },
    RESOURCE_ITEM_FIELDS,
    canFinanceRead,
  );
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
