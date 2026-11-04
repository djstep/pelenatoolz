import "server-only";

import type { prisma } from "@/shared/db/prisma";

/**
 * Новый человек в цехе: пока порядок не меняли (у всех 0), список идёт по фамилии,
 * после перетаскивания новый встаёт в конец.
 */
export async function nextCrewSortOrder(
  db: Pick<typeof prisma, "crewMember">,
  projectId: string,
  departmentId: string | null,
) {
  const { _max } = await db.crewMember.aggregate({
    where: { projectId, departmentId },
    _max: { sortOrder: true },
  });
  const max = _max.sortOrder ?? 0;
  return max > 0 ? max + 1 : 0;
}
