import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  syncShootDayResourceUsages,
  syncShootDaysForScene,
  type SyncResourcesDb,
} from "@/features/schedule/lib/sync-shoot-day-resources";

type Category = { fillInScenes: boolean; perShift: boolean };
type Usage = { id: string; shootDayId: string; itemId: string; isUsed: boolean };

type CategoryWhere = Partial<Category>;
type UsageWhere = {
  shootDayId?: string;
  itemId?: string | { notIn: string[] };
  item?: { category?: CategoryWhere };
};

/**
 * База в памяти: день с посценными сценами, каталог ресурсов (категория у позиции)
 * и записи ресурсов смены. Понимает ровно те запросы, что делает синхронизация.
 */
function fakeDb(setup: {
  items: Record<string, Category>;
  /** sceneId → позиции ресурсов из разбора сцены */
  scenes: Record<string, string[]>;
  /** shootDayId → сцены дня */
  days: Record<string, string[]>;
  usages: Omit<Usage, "id">[];
}) {
  let nextId = 0;
  const usages: Usage[] = setup.usages.map((u) => ({ ...u, id: `u${nextId++}` }));

  function matches(u: Usage, where: UsageWhere): boolean {
    if (where.shootDayId !== undefined && u.shootDayId !== where.shootDayId) return false;
    if (typeof where.itemId === "string" && u.itemId !== where.itemId) return false;
    if (typeof where.itemId === "object" && where.itemId.notIn.includes(u.itemId)) return false;
    const category = setup.items[u.itemId];
    const filter = where.item?.category ?? {};
    for (const [key, value] of Object.entries(filter) as [keyof Category, boolean][]) {
      if (!category || category[key] !== value) return false;
    }
    return true;
  }

  const db = {
    shootDay: {
      async findUnique({ where }: { where: { id: string } }) {
        const sceneIds = setup.days[where.id];
        if (!sceneIds) return null;
        return {
          id: where.id,
          projectId: "p1",
          scenes: sceneIds.map((sceneId) => ({
            sceneId,
            scene: {
              id: sceneId,
              resourceItems: (setup.scenes[sceneId] ?? []).map((itemId) => ({ itemId })),
            },
          })),
        };
      },
    },
    shootDayScene: {
      async findMany({ where }: { where: { sceneId: string } }) {
        return Object.entries(setup.days)
          .filter(([, sceneIds]) => sceneIds.includes(where.sceneId))
          .map(([shootDayId]) => ({ shootDayId }));
      },
    },
    shootDayResourceUsage: {
      async deleteMany({ where }: { where: UsageWhere }) {
        const before = usages.length;
        for (let i = usages.length - 1; i >= 0; i--) {
          if (matches(usages[i]!, where)) usages.splice(i, 1);
        }
        return { count: before - usages.length };
      },
      async upsert({
        where,
        create,
      }: {
        where: { shootDayId_itemId: { shootDayId: string; itemId: string } };
        create: Omit<Usage, "id">;
      }) {
        const key = where.shootDayId_itemId;
        const found = usages.find(
          (u) => u.shootDayId === key.shootDayId && u.itemId === key.itemId,
        );
        if (found) return found;
        const row = { ...create, id: `u${nextId++}` };
        usages.push(row);
        return row;
      },
    },
  };

  return {
    db: db as unknown as SyncResourcesDb,
    itemsOfDay: (shootDayId: string) =>
      usages
        .filter((u) => u.shootDayId === shootDayId)
        .map((u) => u.itemId)
        .sort(),
  };
}

const SCENE_BASED: Category = { fillInScenes: true, perShift: false };
const PER_SHIFT: Category = { fillInScenes: false, perShift: true };
/** Категория, у которой выключены и «из сцен», и «на смену». */
const NEITHER: Category = { fillInScenes: false, perShift: false };

function setup() {
  return fakeDb({
    items: {
      horse: SCENE_BASED,
      carriage: SCENE_BASED,
      oldProp: SCENE_BASED,
      generator: PER_SHIFT,
      stale: NEITHER,
    },
    scenes: { s1: ["horse"], s2: ["carriage"] },
    days: { d1: ["s1", "s2"], d2: ["s2"] },
    usages: [
      // Посменный ресурс добавлен в день руками — должен остаться.
      { shootDayId: "d1", itemId: "generator", isUsed: true },
      // Сцены с этим ресурсом из дня убрали — запись устарела.
      { shootDayId: "d1", itemId: "oldProp", isUsed: true },
      // Категория больше не «из сцен» и не «на смену» — запись устарела.
      { shootDayId: "d1", itemId: "stale", isUsed: true },
      { shootDayId: "d2", itemId: "generator", isUsed: true },
    ],
  });
}

describe("синхронизация ресурсов смены (prunePerShiftResourceUsages)", () => {
  test("«Обновить из КПП» в вызывном: посценные записи из сцен дня остаются", async () => {
    const { db, itemsOfDay } = setup();
    await syncShootDayResourceUsages("d1", db);
    assert.deepEqual(itemsOfDay("d1"), ["carriage", "generator", "horse"]);
  });

  test("правка сцены (syncShootDaysForScene): посценные записи всех её дней остаются", async () => {
    const { db, itemsOfDay } = setup();
    await syncShootDaysForScene("s2", db);
    assert.deepEqual(itemsOfDay("d1"), ["carriage", "generator", "horse"]);
    assert.deepEqual(itemsOfDay("d2"), ["carriage", "generator"]);
  });

  test("повторная синхронизация ничего не меняет", async () => {
    const { db, itemsOfDay } = setup();
    await syncShootDayResourceUsages("d1", db);
    await syncShootDayResourceUsages("d1", db);
    assert.deepEqual(itemsOfDay("d1"), ["carriage", "generator", "horse"]);
  });

  test("день без посценных ресурсов: остаются только посменные", async () => {
    const { db, itemsOfDay } = fakeDb({
      items: { horse: SCENE_BASED, generator: PER_SHIFT },
      scenes: { s1: [] },
      days: { d1: ["s1"] },
      usages: [
        { shootDayId: "d1", itemId: "horse", isUsed: true },
        { shootDayId: "d1", itemId: "generator", isUsed: true },
      ],
    });
    await syncShootDayResourceUsages("d1", db);
    assert.deepEqual(itemsOfDay("d1"), ["generator"]);
  });
});
