import "server-only";

import {
  compareCrewRows,
  toCrewRow,
  type CrewDepartment,
  type CrewRights,
  type CrewRow,
} from "@/features/crew/lib/crew-rules";
import { prisma } from "@/shared/db/prisma";

/** Договор глазами команды: сумм в этом запросе нет вообще. */
const contractLinksSelect = {
  select: {
    contract: {
      select: {
        id: true,
        number: true,
        date: true,
        status: { select: { key: true, name: true, color: true } },
      },
    },
  },
} as const;

/** Вся команда проекта, с архивом. Что уйдёт в браузер, решает `toCrewRow` по правам. */
export async function listCrew(projectId: string, rights: CrewRights): Promise<CrewRow[]> {
  const records = await prisma.crewMember.findMany({
    where: { projectId },
    include: {
      department: { select: { name: true } },
      contractLinks: contractLinksSelect,
    },
  });
  return records.map((record) => toCrewRow(record, rights)).sort(compareCrewRows);
}

/** Только названия цехов: главы и сметы в команде не нужны. */
export function listCrewDepartments(projectId: string): Promise<CrewDepartment[]> {
  return prisma.department.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}
