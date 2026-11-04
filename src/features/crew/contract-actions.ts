"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  listCrewLinkOptions,
  listCrewPullCandidates,
  loadCrewSyncMember,
  type CrewLinkOption,
} from "@/features/crew/contract-queries";
import {
  crewAuditChanges,
  crewCanUseContracts,
  crewFullName,
  crewMainContract,
  crewRights,
  crewWriteData,
  type CrewRights,
  type CrewRowContract,
} from "@/features/crew/lib/crew-rules";
import {
  crewSyncPlan,
  crewSyncRows,
  isPullableCounterparty,
  isRejectedStatus,
  pullSnapshot,
  type CrewPullCandidate,
  type CrewSyncRow,
} from "@/features/crew/lib/crew-sync";
import { crewIdSchema, crewPullSchema, crewSyncFieldsSchema } from "@/features/crew/schemas";
import { nextCrewSortOrder } from "@/features/crew/sort-order";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

const NO_RIGHTS = "Недостаточно прав";
const NOT_FOUND = "Запись не найдена";
/** Подпись в `changes`: журнал вырезает её без права на договоры (`entity-access.ts`). */
const AUDIT_CONTRACT_FIELD = "Договор";
/** Подтянуть за раз можно до 100 человек, у каждого несколько запросов. */
const PULL_TX = { timeout: 60_000, maxWait: 10_000 } as const;

type ContractsAccess =
  | { allowed: false }
  | {
      allowed: true;
      ctx: Awaited<ReturnType<typeof requireProjectContext>>;
      rights: CrewRights;
    };

/** Договорные действия команды: нужны и «Договоры: просмотр», и правка команды. */
async function contractsAccess(projectId: string): Promise<ContractsAccess> {
  const ctx = await requireProjectContext(projectId);
  const rights = crewRights(ctx.can);
  return crewCanUseContracts(rights) ? { allowed: true, ctx, rights } : { allowed: false };
}

function revalidateCrew(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/crew`);
}

function auditContractNumbers(numbers: string[]) {
  return { [AUDIT_CONTRACT_FIELD]: { from: null, to: numbers.map((n) => `№ ${n}`).join(", ") } };
}

/**
 * Защита от дублей при двух одновременных запросах: второй ждёт первого и уже видит его связи.
 * Строки — в одном порядке, чтобы запросы не заблокировали друг друга.
 */
async function lockCounterparties(tx: Pick<typeof prisma, "$queryRaw">, ids: string[]) {
  await tx.$queryRaw`
    SELECT "id" FROM "Counterparty"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE`;
}

export type CrewPullLoad = { error?: string; candidates?: CrewPullCandidate[] };

export async function getCrewPullCandidatesAction(projectId: string): Promise<CrewPullLoad> {
  const access = await contractsAccess(projectId);
  if (!access.allowed) return { error: NO_RIGHTS };
  return { candidates: await listCrewPullCandidates(projectId, access.rights) };
}

export type CrewPullResult = {
  error?: string;
  created?: number;
  linked?: number;
  skipped?: number;
};

/**
 * «Подтянуть»: контрагент — один человек. Что бы ни прислал браузер, в транзакции заново
 * проверяется, есть ли контрагент в команде: если есть, договор только связывается, поэтому
 * повторный запрос второго человека не создаст. Без права на контакты телефона и почты в
 * записи нет: их нет ни в данных формы, ни в снимке.
 */
export async function pullCrewFromContractsAction(
  projectId: string,
  items: unknown,
): Promise<CrewPullResult> {
  const access = await contractsAccess(projectId);
  if (!access.allowed) return { error: NO_RIGHTS };
  const { ctx, rights } = access;

  const parsed = crewPullSchema.safeParse(items);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }
  const list = parsed.data;
  const counterpartyIds = [...new Set(list.map((item) => item.counterpartyId))];

  try {
    await assertInProject("Counterparty", counterpartyIds, projectId);
    await assertInProject(
      "CrewMember",
      list.flatMap((item) => (item.mode === "link" ? [item.memberId] : [])),
      projectId,
    );
    await assertInProject(
      "Department",
      list.flatMap((item) => (item.mode === "create" && item.person.departmentId) || []),
      projectId,
    );
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockCounterparties(tx, counterpartyIds);
    const counts = { created: 0, linked: 0, skipped: 0 };

    for (const item of list) {
      const counterparty = await tx.counterparty.findFirstOrThrow({
        where: { id: item.counterpartyId, projectId },
        select: {
          name: true,
          type: true,
          contacts: true,
          contracts: {
            orderBy: { date: "desc" },
            select: {
              id: true,
              number: true,
              status: { select: { key: true } },
              crewLinks: { select: { crewMemberId: true } },
            },
          },
        },
      });
      const open = counterparty.contracts.filter(
        (c) => !isRejectedStatus(c.status) && c.crewLinks.length === 0,
      );
      // ООО и всё уже разобранное сюда попадает только из подделанного или устаревшего запроса.
      if (!isPullableCounterparty(counterparty.type) || open.length === 0) {
        counts.skipped += 1;
        continue;
      }

      const numbers = open.map((c) => c.number);
      const links = open.map((c) => ({ contractId: c.id }));
      const memberInTeam = counterparty.contracts.flatMap((c) => c.crewLinks)[0]?.crewMemberId;
      const targetId = memberInTeam ?? (item.mode === "link" ? item.memberId : null);

      if (targetId) {
        const member = await tx.crewMember.update({
          where: { id: targetId, projectId },
          data: { source: "CONTRACT", contractLinks: { create: links } },
          select: { lastName: true, firstName: true, middleName: true },
        });
        await auditMutation(ctx, async () => undefined, null, {
          projectId,
          entityType: AuditEntityType.crewMember,
          action: "UPDATE",
          entityId: targetId,
          summary: `Связан с договором: ${crewFullName(member)}`,
          changes: { fields: auditContractNumbers(numbers) },
        }, { db: tx });
        counts.linked += 1;
        continue;
      }
      if (item.mode !== "create") continue;

      const data = crewWriteData(item.person, rights);
      const sortOrder = await nextCrewSortOrder(tx, projectId, data.departmentId);
      await auditMutation(
        ctx,
        () =>
          tx.crewMember.create({
            data: {
              ...data,
              projectId,
              sortOrder,
              source: "CONTRACT",
              syncedAt: new Date(),
              syncedValues: pullSnapshot(counterparty, rights),
              createdById: ctx.user.id!,
              contractLinks: { create: links },
            },
            select: { id: true },
          }),
        null,
        {
          projectId,
          entityType: AuditEntityType.crewMember,
          action: "CREATE",
          entityId: (_, row) => row.id,
          summary: `Добавлен в команду из договора: ${crewFullName(data)}`,
          changes: { fields: auditContractNumbers(numbers) },
        },
        { db: tx },
      );
      counts.created += 1;
    }
    return counts;
  }, PULL_TX);

  revalidateCrew(projectId);
  return result;
}

export type CrewLinkLoad = { error?: string; options?: CrewLinkOption[] };

export async function getCrewLinkOptionsAction(
  projectId: string,
  memberId: string,
): Promise<CrewLinkLoad> {
  const access = await contractsAccess(projectId);
  if (!access.allowed) return { error: NO_RIGHTS };
  const id = crewIdSchema.safeParse(memberId);
  if (!id.success) return { error: NOT_FOUND };
  try {
    await assertInProject("CrewMember", id.data, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }
  return { options: await listCrewLinkOptions(projectId, id.data) };
}

/** «Связать с договором»: данные не копируются, разницу покажет «Обновить из договора». */
export async function linkCrewMemberContractAction(
  projectId: string,
  memberId: string,
  contractId: string,
): Promise<{ error?: string }> {
  const access = await contractsAccess(projectId);
  if (!access.allowed) return { error: NO_RIGHTS };
  const { ctx } = access;

  const ids = crewIdSchema.array().length(2).safeParse([memberId, contractId]);
  if (!ids.success) return { error: NOT_FOUND };
  try {
    await assertInProject("CrewMember", memberId, projectId);
    await assertInProject("Contract", contractId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }

  const refused = await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirstOrThrow({
      where: { id: contractId, projectId },
      select: {
        number: true,
        status: { select: { key: true } },
        counterpartyId: true,
        counterparty: { select: { type: true } },
      },
    });
    await lockCounterparties(tx, [contract.counterpartyId]);
    if (isRejectedStatus(contract.status)) return "Договор отклонён";

    if (contract.counterparty.type !== "LEGAL_ENTITY") {
      const other = await tx.crewMemberContract.findFirst({
        where: {
          crewMemberId: { not: memberId },
          contract: { projectId, counterpartyId: contract.counterpartyId },
        },
        select: { crewMember: { select: { lastName: true, firstName: true, middleName: true } } },
      });
      if (other) return `Этот контрагент уже в команде: ${crewFullName(other.crewMember)}`;
    }

    const already = await tx.crewMemberContract.findUnique({
      where: { crewMemberId_contractId: { crewMemberId: memberId, contractId } },
      select: { id: true },
    });
    if (already) return "Договор уже связан";

    const member = await tx.crewMember.update({
      where: { id: memberId, projectId },
      data: { source: "CONTRACT", contractLinks: { create: { contractId } } },
      select: { lastName: true, firstName: true, middleName: true },
    });
    await auditMutation(ctx, async () => undefined, null, {
      projectId,
      entityType: AuditEntityType.crewMember,
      action: "UPDATE",
      entityId: memberId,
      summary: `Связан с договором: ${crewFullName(member)}`,
      changes: { fields: auditContractNumbers([contract.number]) },
    }, { db: tx });
    return null;
  });
  if (refused) return { error: refused };

  revalidateCrew(projectId);
  return {};
}

export type CrewSyncContract = CrewRowContract & {
  counterpartyName: string;
  legalEntity: boolean;
};

export type CrewSyncPreview = {
  error?: string;
  contracts?: CrewSyncContract[];
  contractId?: string;
  rows?: CrewSyncRow[];
  /** Снимка ещё нет: запись связали с договором вручную и ни разу не обновляли. */
  neverSynced?: boolean;
};

/** Разница «человек — договор». Значения контактов есть, только если на них есть право. */
export async function getCrewSyncPreviewAction(
  projectId: string,
  memberId: string,
  contractId?: string,
): Promise<CrewSyncPreview> {
  const access = await contractsAccess(projectId);
  if (!access.allowed) return { error: NO_RIGHTS };
  if (!crewIdSchema.safeParse(memberId).success) return { error: NOT_FOUND };

  const member = await loadCrewSyncMember(prisma, projectId, memberId);
  if (!member) return { error: NOT_FOUND };

  const contracts = member.contractLinks
    .map(({ contract }) => contract)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const listed: CrewSyncContract[] = contracts.map((c) => ({
    id: c.id,
    number: c.number,
    date: c.date.toISOString(),
    statusName: c.status.name,
    statusColor: c.status.color,
    rejected: isRejectedStatus(c.status),
    counterpartyName: c.counterparty.name,
    legalEntity: c.counterparty.type === "LEGAL_ENTITY",
  }));
  const selectedId = contractId ?? crewMainContract(listed)?.id;
  const selected = contracts.find((c) => c.id === selectedId);
  if (!selected) return { error: "Договор не найден" };

  return {
    contracts: listed,
    contractId: selected.id,
    rows: crewSyncRows(member, member.syncedValues, selected.counterparty, access.rights),
    neverSynced: member.syncedAt == null,
  };
}

/** «Обновить из договора»: значения берутся из базы, браузер присылает только названия полей. */
export async function applyCrewSyncAction(
  projectId: string,
  memberId: string,
  contractId: string,
  fields: unknown,
): Promise<{ error?: string }> {
  const access = await contractsAccess(projectId);
  if (!access.allowed) return { error: NO_RIGHTS };
  const { ctx, rights } = access;

  const parsed = crewSyncFieldsSchema.safeParse(fields);
  if (!parsed.success) return { error: "Выберите поля" };
  if (!crewIdSchema.safeParse(memberId).success) return { error: NOT_FOUND };

  const refused = await prisma.$transaction(async (tx) => {
    const member = await loadCrewSyncMember(tx, projectId, memberId);
    const contract = member?.contractLinks.find((l) => l.contract.id === contractId)?.contract;
    if (!member || !contract) return NOT_FOUND;

    const plan = crewSyncPlan(
      member,
      member.syncedValues,
      contract.counterparty,
      rights,
      parsed.data,
    );
    if (plan.labels.length === 0) return "Отличий от договора нет";

    await auditMutation(
      ctx,
      () =>
        tx.crewMember.update({
          where: { id: memberId, projectId },
          data: {
            ...plan.data,
            lastName: plan.data.lastName ?? member.lastName,
            syncedAt: new Date(),
            syncedValues: plan.snapshot,
          },
          select: { id: true },
        }),
      null,
      {
        projectId,
        entityType: AuditEntityType.crewMember,
        action: "UPDATE",
        entityId: memberId,
        summary: `Обновлён из договора: ${crewFullName({ ...member, ...plan.data, lastName: plan.data.lastName ?? member.lastName })} (${plan.labels.join(", ")})`,
        changes: {
          fields: {
            ...auditContractNumbers([contract.number]),
            ...crewAuditChanges(member, plan.data).fields,
          },
        },
      },
      { db: tx },
    );
    return null;
  });
  if (refused) return { error: refused };

  revalidateCrew(projectId);
  return {};
}
