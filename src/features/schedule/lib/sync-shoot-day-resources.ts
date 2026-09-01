import { prisma } from "@/shared/db/prisma";

/** Синхронизирует посценные ресурсы из сцен дня (каталог §9). */
async function syncSceneResourceUsages(shootDayId: string) {
  const day = await prisma.shootDay.findUnique({
    where: { id: shootDayId },
    include: {
      scenes: {
        include: {
          scene: {
            include: {
              resourceItems: { select: { itemId: true } },
            },
          },
        },
      },
    },
  });
  if (!day) return;

  const desired = new Set<string>();
  for (const row of day.scenes) {
    for (const link of row.scene.resourceItems) {
      desired.add(link.itemId);
    }
  }

  if (desired.size === 0) {
    await prisma.shootDayResourceUsage.deleteMany({
      where: {
        shootDayId,
        item: { category: { fillInScenes: true, perShift: false } },
      },
    });
    return;
  }

  await prisma.shootDayResourceUsage.deleteMany({
    where: {
      shootDayId,
      itemId: { notIn: [...desired] },
      item: { category: { fillInScenes: true, perShift: false } },
    },
  });

  for (const itemId of desired) {
    await prisma.shootDayResourceUsage.upsert({
      where: { shootDayId_itemId: { shootDayId, itemId } },
      create: { shootDayId, itemId, isUsed: true },
      update: {},
    });
  }
}

/** Синхронизирует посменные ресурсы из каталога (категории с perShift). */
async function syncPerShiftResourceUsages(shootDayId: string, projectId: string) {
  const perShiftItems = await prisma.resourceItem.findMany({
    where: { category: { projectId, perShift: true } },
    select: { id: true },
  });

  const desired = new Set(perShiftItems.map((item) => item.id));

  if (desired.size === 0) {
    await prisma.shootDayResourceUsage.deleteMany({
      where: {
        shootDayId,
        item: { category: { perShift: true } },
      },
    });
    return;
  }

  await prisma.shootDayResourceUsage.deleteMany({
    where: {
      shootDayId,
      itemId: { notIn: [...desired] },
      item: { category: { perShift: true } },
    },
  });

  for (const itemId of desired) {
    await prisma.shootDayResourceUsage.upsert({
      where: { shootDayId_itemId: { shootDayId, itemId } },
      create: { shootDayId, itemId, isUsed: true },
      update: {},
    });
  }
}

/** Синхронизирует все ресурсы смены: посценные + посменные. */
export async function syncShootDayResourceUsages(shootDayId: string) {
  const day = await prisma.shootDay.findUnique({
    where: { id: shootDayId },
    select: { projectId: true },
  });
  if (!day) return;

  await syncSceneResourceUsages(shootDayId);
  await syncPerShiftResourceUsages(shootDayId, day.projectId);
}

export async function syncShootDaysForScene(sceneId: string) {
  const links = await prisma.shootDayScene.findMany({
    where: { sceneId },
    select: { shootDayId: true },
  });
  for (const link of links) {
    await syncShootDayResourceUsages(link.shootDayId);
  }
}
