import { prisma } from "@/shared/db/prisma";

/** База или её подмена в тесте: только то, что нужно синхронизации. */
export type SyncResourcesDb = Pick<
  typeof prisma,
  "shootDay" | "shootDayScene" | "shootDayResourceUsage"
>;

/** Синхронизирует посценные ресурсы из сцен дня (каталог §9). */
async function syncSceneResourceUsages(db: SyncResourcesDb, shootDayId: string) {
  const day = await db.shootDay.findUnique({
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
    await db.shootDayResourceUsage.deleteMany({
      where: {
        shootDayId,
        item: { category: { fillInScenes: true, perShift: false } },
      },
    });
    return;
  }

  await db.shootDayResourceUsage.deleteMany({
    where: {
      shootDayId,
      itemId: { notIn: [...desired] },
      item: { category: { fillInScenes: true, perShift: false } },
    },
  });

  for (const itemId of desired) {
    await db.shootDayResourceUsage.upsert({
      where: { shootDayId_itemId: { shootDayId, itemId } },
      create: { shootDayId, itemId, isUsed: true },
      update: {},
    });
  }
}

/**
 * Убирает устаревшие записи (без автодобавления): категория ресурса теперь ни «из сцен»,
 * ни «на смену». Посценные записи (их только что поставил syncSceneResourceUsages) и
 * посменные, добавленные руками, не трогает.
 */
async function prunePerShiftResourceUsages(db: SyncResourcesDb, shootDayId: string) {
  await db.shootDayResourceUsage.deleteMany({
    where: {
      shootDayId,
      item: { category: { fillInScenes: false, perShift: false } },
    },
  });
}

/** Синхронизирует все ресурсы смены: посценные + посменные. */
export async function syncShootDayResourceUsages(
  shootDayId: string,
  db: SyncResourcesDb = prisma,
) {
  const day = await db.shootDay.findUnique({
    where: { id: shootDayId },
    select: { projectId: true },
  });
  if (!day) return;

  await syncSceneResourceUsages(db, shootDayId);
  await prunePerShiftResourceUsages(db, shootDayId);
}

export async function syncShootDaysForScene(sceneId: string, db: SyncResourcesDb = prisma) {
  const links = await db.shootDayScene.findMany({
    where: { sceneId },
    select: { shootDayId: true },
  });
  for (const link of links) {
    await syncShootDayResourceUsages(link.shootDayId, db);
  }
}
