import "server-only";

import { prisma } from "@/shared/db/prisma";

/** Имя модели из схемы. Новый вид сущности — ещё одно значение и один case. */
export type AssertInProjectEntity =
  | "Scene"
  | "ScriptVersion"
  | "ScriptComment"
  | "Location"
  | "LocationPhoto"
  | "ResourceItem";

type TransactionCallback = Extract<
  Parameters<typeof prisma.$transaction>[0],
  (client: never) => Promise<unknown>
>;

type InteractiveTx = TransactionCallback extends (
  client: infer T,
) => Promise<unknown>
  ? T
  : never;

type ProjectDb = Pick<
  InteractiveTx,
  | "scene"
  | "scriptVersion"
  | "scriptComment"
  | "location"
  | "locationPhoto"
  | "resourceItem"
>;

/**
 * Проверяет, что записи с этими id принадлежат проекту.
 * Вызывать до любой записи, если id сущности пришёл из браузера.
 * Нет записи и чужой проект дают одну и ту же ошибку.
 */
export async function assertInProject(
  entity: AssertInProjectEntity,
  ids: string | readonly string[],
  projectId: string,
  tx?: ProjectDb,
): Promise<void> {
  const uniqueIds = [...new Set(typeof ids === "string" ? [ids] : ids)];
  if (uniqueIds.length === 0) return;

  const db: ProjectDb = tx ?? prisma;
  const found = await countInProject(db, entity, uniqueIds, projectId);
  if (found < uniqueIds.length) {
    throw new Error("Объект не найден");
  }
}

async function countInProject(
  db: ProjectDb,
  entity: AssertInProjectEntity,
  ids: string[],
  projectId: string,
): Promise<number> {
  switch (entity) {
    case "Scene":
      return db.scene.count({
        where: { id: { in: ids }, projectId },
      });
    case "ScriptVersion":
      return db.scriptVersion.count({
        where: { id: { in: ids }, projectId },
      });
    case "ScriptComment":
      return db.scriptComment.count({
        where: {
          id: { in: ids },
          scriptVersion: { projectId },
        },
      });
    case "Location":
      return db.location.count({
        where: { id: { in: ids }, projectId },
      });
    case "LocationPhoto":
      return db.locationPhoto.count({
        where: {
          id: { in: ids },
          location: { projectId },
        },
      });
    case "ResourceItem":
      return db.resourceItem.count({
        where: {
          id: { in: ids },
          category: { projectId },
        },
      });
    default: {
      const unexpected: never = entity;
      void unexpected;
      throw new Error("Объект не найден");
    }
  }
}
