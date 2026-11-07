import "server-only";

import { prisma } from "@/shared/db/prisma";

export type PrepEventTypeRow = {
  id: string;
  name: string;
  color: string;
  isHidden: boolean;
  /** Сколько событий этого типа: с событиями тип нельзя удалить, только скрыть. */
  eventCount: number;
};

/** Справочник типов проекта, по порядку. */
export async function listPrepEventTypes(projectId: string): Promise<PrepEventTypeRow[]> {
  const rows = await prisma.prepEventType.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      isHidden: true,
      _count: { select: { events: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({ ...row, eventCount: _count.events }));
}
