import type { Prisma } from "@prisma/client";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMemberName } from "@/shared/audit/member-name";
import type { AuditMeta } from "@/shared/audit/with-audit";

/** Отказ при попытке понизить, удалить или переназначить владельца проекта. */
export const OWNER_PROTECTED_ERROR = "Это владелец проекта — сначала передайте владение";

/** Отказ при правке или удалении роли, которая назначена владельцу. */
export const OWNER_ROLE_ERROR = "Эта роль назначена владельцу проекта — сначала передайте владение";

export const OWNER_ONLY_TRANSFER_ERROR = "Передать владение может только владелец проекта";
export const OWNER_ONLY_DELETE_ERROR = "Удалить проект может только его владелец";
export const TRANSFER_TO_PRODUCER_ERROR =
  "Владение можно передать только участнику с ролью «Продюсер»";

export function isProjectOwner(userId: string, ownerUserId: string | null): boolean {
  return ownerUserId != null && userId === ownerUserId;
}

/** Смена роли или удаление участника: владельца не трогает никто, даже продюсер. */
export function memberChangeRefusal(
  targetUserId: string,
  ownerUserId: string | null,
): string | null {
  return isProjectOwner(targetUserId, ownerUserId) ? OWNER_PROTECTED_ERROR : null;
}

/** Передача владения: только владелец, только другому активному продюсеру (`target` — его участие или null). */
export function transferRefusal(input: {
  actorUserId: string;
  ownerUserId: string | null;
  target: { userId: string; isProducer: boolean } | null;
}): string | null {
  if (!isProjectOwner(input.actorUserId, input.ownerUserId)) return OWNER_ONLY_TRANSFER_ERROR;
  if (!input.target) return "Участник не найден";
  if (input.target.userId === input.actorUserId) return "Вы уже владелец проекта";
  if (!input.target.isProducer) return TRANSFER_TO_PRODUCER_ERROR;
  return null;
}

/** Удаление проекта — только владелец. Архив и восстановление — по правам, как раньше. */
export function deleteProjectRefusal(
  actorUserId: string,
  ownerUserId: string | null,
): string | null {
  return isProjectOwner(actorUserId, ownerUserId) ? null : OWNER_ONLY_DELETE_ERROR;
}

/** Запись журнала «Проект создан»: тип «Проект», имя владельца без почты. */
export function projectCreatedAuditMeta(input: {
  projectId: string;
  projectName: string;
  ownerUserId: string;
  ownerName: string | null | undefined;
  roleId: string;
  roleName: string;
}): AuditMeta<unknown, unknown> {
  const ownerName = auditMemberName(input.ownerName);
  return {
    projectId: input.projectId,
    entityType: AuditEntityType.project,
    entityId: input.projectId,
    action: "CREATE",
    summary: `Проект «${input.projectName}» создан, владелец «${ownerName}», роль «${input.roleName}»`,
    changes: {
      ownerUserId: input.ownerUserId,
      ownerName,
      roleId: input.roleId,
      roleName: input.roleName,
    },
  };
}

type LockDb = { $queryRaw: Prisma.TransactionClient["$queryRaw"] };

/**
 * Блокирует строку проекта до конца транзакции и возвращает владельца.
 * Всё, что меняет владельца или участников-продюсеров, идёт под этой блокировкой:
 * двойной клик и вторая вкладка выполняются по очереди и видят результат первой.
 */
export async function lockProjectOwner(
  tx: LockDb,
  projectId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ ownerUserId: string }[]>`
    SELECT "ownerUserId" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`;
  return rows[0]?.ownerUserId ?? null;
}
