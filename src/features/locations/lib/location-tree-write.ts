import "server-only";
import { parsePlace, usesLegacySlash } from "@/features/import/normalize/heading";
import { cleanSpaces, compareKey } from "@/features/import/normalize/text";
import type { prisma } from "@/shared/db/prisma";

/**
 * Запись дерева объектов (объект → подобъекты) для серверных действий «Локаций» и сценария.
 * Не серверное действие: `projectId` сюда приходит только из проверенного контекста.
 */

/** Клиент базы или транзакция: нужны только объекты и блокировка. */
export type LocationDb = Pick<typeof prisma, "location" | "$executeRaw">;

/** Строка, созданная попутно, — для журнала. */
export type CreatedLocation = { id: string; title: string };

/**
 * Объект проекта с этим названием — сравнение как у импорта (`compareKey`: регистр, пробелы,
 * Ё = Е); из нескольких — самый ранний; строка `exceptId` не в счёт. Нет — создаётся и
 * попадает в `created`. Только строки без родителя: вложенность — один уровень.
 * Блокировка по названию до конца транзакции: два одновременных сохранения не создадут
 * два объекта. Вызывать внутри транзакции.
 */
export async function findOrCreateObject(
  tx: LocationDb,
  projectId: string,
  name: string,
  exceptId: string | null,
  created: CreatedLocation[],
) {
  const key = compareKey(name);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`location:${projectId}:${key}`}))`;
  const objects = await tx.location.findMany({
    where: { projectId, parentId: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  const found = objects.find((o) => compareKey(o.name) === key);
  if (found) return { id: found.id, name: found.name };
  const object = await tx.location.create({
    data: { projectId, name: cleanSpaces(name) },
    select: { id: true, name: true },
  });
  created.push({ id: object.id, title: object.name });
  return object;
}

/** Новый подобъект — в конец объекта. */
export async function nextSubOrder(tx: LocationDb, projectId: string, parentId: string) {
  const last = await tx.location.aggregate({
    where: { projectId, parentId },
    _max: { sortOrder: true },
  });
  return (last._max.sortOrder ?? 0) + 1;
}

/**
 * Подобъект объекта с этим названием (сравнение как у импорта); нет — создаётся в конце
 * объекта и попадает в `created`. Вызывать внутри транзакции.
 */
export async function findOrCreateSub(
  tx: LocationDb,
  projectId: string,
  object: { id: string; name: string },
  name: string,
  created: CreatedLocation[],
) {
  const key = compareKey(name);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`location:${object.id}:${key}`}))`;
  const subs = await tx.location.findMany({
    where: { projectId, parentId: object.id },
    select: { id: true, name: true },
  });
  const found = subs.find((s) => compareKey(s.name) === key);
  if (found) return found;
  const clean = cleanSpaces(name);
  const sub = await tx.location.create({
    data: {
      projectId,
      parentId: object.id,
      name: clean,
      sortOrder: await nextSubOrder(tx, projectId, object.id),
    },
    select: { id: true, name: true },
  });
  created.push({ id: sub.id, title: `${object.name}.${clean}` });
  return sub;
}

/**
 * Место из шапки сценария («ДОМ. ВАННАЯ / КОРИДОР») по правилу шапки, как у импорта:
 * объекты и подобъекты, которых нет, создаются (`created`). Ответ — первый объект или
 * null, если места нет. Вызывать внутри транзакции.
 */
export async function ensurePlace(
  tx: LocationDb,
  projectId: string,
  place: string,
  created: CreatedLocation[],
) {
  const text = cleanSpaces(place).toUpperCase().slice(0, 300);
  // Одна шапка: старая запись («КВАРТИРА/СПАЛЬНЯ///КОРИДОР») — по «///» в ней самой.
  const pieces = parsePlace(text, { legacySlash: usesLegacySlash([text]) });
  let first: { id: string; name: string } | null = null;
  for (const piece of pieces) {
    const object = await findOrCreateObject(tx, projectId, piece.object, null, created);
    first ??= object;
    if (piece.sub) await findOrCreateSub(tx, projectId, object, piece.sub, created);
  }
  return first;
}
