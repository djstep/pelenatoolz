import "server-only";

import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

/** Имя модели из схемы. Новый вид сущности — ещё одно значение и один case. */
export type AssertInProjectEntity =
  | "Scene"
  | "ScriptVersion"
  | "ScriptBlock"
  | "ScriptComment"
  | "Location"
  | "LocationPhoto"
  | "ResourceItem"
  | "Company"
  | "Counterparty"
  | "ProjectApprovalStatus"
  | "ProjectLedgerType"
  | "Contract"
  | "CashPayment"
  | "Character"
  | "Actor"
  | "Element"
  | "CastingCandidate"
  | "Department"
  /** Только активный участник (не приглашённый и не удалённый). */
  | "ProjectMembership";

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
  | "scriptBlock"
  | "scriptComment"
  | "location"
  | "locationPhoto"
  | "resourceItem"
  | "company"
  | "counterparty"
  | "projectApprovalStatus"
  | "projectLedgerType"
  | "contract"
  | "cashPayment"
  | "character"
  | "actor"
  | "element"
  | "castingCandidate"
  | "department"
  | "projectMembership"
>;

/** Нет записи и чужой проект. Текст один, чтобы по ответу нельзя было их различить. */
export class NotInProjectError extends Error {
  constructor(message = "Объект не найден") {
    super(message);
    this.name = "NotInProjectError";
  }
}

export function isNotInProjectError(
  error: unknown,
): error is NotInProjectError {
  return error instanceof NotInProjectError;
}

/**
 * Проверяет, что записи с этими id принадлежат проекту.
 * Вызывать до любой записи, если id сущности пришёл из браузера.
 * Нет записи и чужой проект дают одну и ту же ошибку.
 * Пустая строка, null и пустой список — не ссылка, проверка не нужна.
 */
export async function assertInProject(
  entity: AssertInProjectEntity,
  ids: string | readonly string[],
  projectId: string,
  tx?: ProjectDb,
): Promise<void> {
  const list = typeof ids === "string" ? [ids] : ids;
  const uniqueIds = [
    ...new Set(list.filter((id) => id.trim().length > 0)),
  ];
  if (uniqueIds.length === 0) return;

  const db: ProjectDb = tx ?? prisma;
  const found = await countInProject(db, entity, uniqueIds, projectId);
  if (found < uniqueIds.length) {
    throw new NotInProjectError();
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
    case "ScriptBlock":
      return db.scriptBlock.count({
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
    case "Company":
      return db.company.count({
        where: { id: { in: ids }, projectId },
      });
    case "Counterparty":
      return db.counterparty.count({
        where: { id: { in: ids }, projectId },
      });
    case "ProjectApprovalStatus":
      return db.projectApprovalStatus.count({
        where: { id: { in: ids }, projectId },
      });
    case "ProjectLedgerType":
      return db.projectLedgerType.count({
        where: { id: { in: ids }, projectId },
      });
    case "Contract":
      return db.contract.count({
        where: { id: { in: ids }, projectId },
      });
    case "CashPayment":
      return db.cashPayment.count({
        where: { id: { in: ids }, projectId },
      });
    case "Character":
      return db.character.count({
        where: { id: { in: ids }, projectId },
      });
    case "Actor":
      return db.actor.count({
        where: { id: { in: ids }, projectId },
      });
    case "Element":
      return db.element.count({
        where: { id: { in: ids }, projectId },
      });
    case "CastingCandidate":
      return db.castingCandidate.count({
        where: { id: { in: ids }, projectId },
      });
    case "Department":
      return db.department.count({
        where: { id: { in: ids }, projectId },
      });
    case "ProjectMembership":
      return db.projectMembership.count({
        where: {
          id: { in: ids },
          projectId,
          status: MembershipStatus.ACTIVE,
        },
      });
    default: {
      const unexpected: never = entity;
      void unexpected;
      throw new NotInProjectError();
    }
  }
}
