import "server-only";

import type { CounterpartyType, Prisma } from "@prisma/client";

import { REJECTED_CONTRACT_STATUS_KEY, type CrewRights } from "@/features/crew/lib/crew-rules";
import {
  PULLABLE_COUNTERPARTY_TYPES,
  toCrewPullCandidate,
  type CrewMatchRecord,
  type CrewPullCandidate,
} from "@/features/crew/lib/crew-sync";
import { prisma } from "@/shared/db/prisma";

/**
 * Договоры глазами команды. Сумм в этих запросах нет вообще: в начислениях берутся только
 * дата и цех статьи. Вызывать только из действий с проверкой прав (`contract-actions.ts`).
 */

/** У своих статусов проекта ключа нет: `key <> …` в SQL их бы потерял. */
const NOT_REJECTED: Prisma.ProjectApprovalStatusWhereInput = {
  OR: [{ key: null }, { key: { not: REJECTED_CONTRACT_STATUS_KEY } }],
};

const STATUS_SELECT = { select: { key: true, name: true, color: true } } as const;

function listCrewForMatching(projectId: string): Promise<CrewMatchRecord[]> {
  return prisma.crewMember.findMany({
    where: { projectId },
    select: {
      id: true,
      lastName: true,
      firstName: true,
      middleName: true,
      phone: true,
      archivedAt: true,
    },
  });
}

export async function listCrewPullCandidates(
  projectId: string,
  rights: Pick<CrewRights, "contacts">,
): Promise<CrewPullCandidate[]> {
  const [records, members] = await Promise.all([
    prisma.counterparty.findMany({
      where: {
        projectId,
        type: { in: [...PULLABLE_COUNTERPARTY_TYPES] },
        contracts: { some: { status: NOT_REJECTED } },
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        contacts: true,
        contracts: {
          select: {
            id: true,
            number: true,
            date: true,
            status: STATUS_SELECT,
            crewLinks: { select: { crewMemberId: true } },
            accruals: {
              // Обнулённые начисления отчёта смены работы по этой статье не подтверждают.
              where: { reportZeroedAt: null, budgetItemId: { not: null } },
              select: { date: true, budgetItem: { select: { departmentId: true } } },
            },
          },
        },
      },
    }),
    listCrewForMatching(projectId),
  ]);
  return records.flatMap((record) => toCrewPullCandidate(record, members, rights) ?? []);
}

export type CrewLinkOption = {
  id: string;
  number: string;
  date: string;
  statusName: string;
  statusColor: string;
  counterpartyName: string;
  counterpartyType: CounterpartyType;
};

/**
 * Договоры для «Связать с договором»: все, кроме отклонённых и уже связанных с этим человеком.
 * Физлицо, самозанятый или ИП — один человек, поэтому занятые другими контрагенты не предлагаются.
 * У ООО людей может быть несколько.
 */
export async function listCrewLinkOptions(
  projectId: string,
  memberId: string,
): Promise<CrewLinkOption[]> {
  const [contracts, taken] = await Promise.all([
    prisma.contract.findMany({
      where: {
        projectId,
        status: NOT_REJECTED,
        crewLinks: { none: { crewMemberId: memberId } },
      },
      orderBy: [{ date: "desc" }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        date: true,
        status: STATUS_SELECT,
        counterparty: { select: { id: true, name: true, type: true } },
      },
    }),
    prisma.crewMemberContract.findMany({
      where: {
        crewMemberId: { not: memberId },
        contract: { projectId, counterparty: { type: { not: "LEGAL_ENTITY" } } },
      },
      select: { contract: { select: { counterpartyId: true } } },
    }),
  ]);
  const takenCounterparties = new Set(taken.map((link) => link.contract.counterpartyId));
  return contracts
    .filter((c) => !takenCounterparties.has(c.counterparty.id))
    .map((c) => ({
      id: c.id,
      number: c.number,
      date: c.date.toISOString(),
      statusName: c.status.name,
      statusColor: c.status.color,
      counterpartyName: c.counterparty.name,
      counterpartyType: c.counterparty.type,
    }));
}

/** Человек с договорами для «Обновить из договора». Снимок и контакты контрагента — только серверу. */
export function loadCrewSyncMember(
  db: Pick<typeof prisma, "crewMember">,
  projectId: string,
  memberId: string,
) {
  return db.crewMember.findFirst({
    where: { id: memberId, projectId },
    select: {
      lastName: true,
      firstName: true,
      middleName: true,
      phone: true,
      email: true,
      syncedAt: true,
      syncedValues: true,
      contractLinks: {
        select: {
          contract: {
            select: {
              id: true,
              number: true,
              date: true,
              status: STATUS_SELECT,
              counterparty: { select: { name: true, type: true, contacts: true } },
            },
          },
        },
      },
    },
  });
}
