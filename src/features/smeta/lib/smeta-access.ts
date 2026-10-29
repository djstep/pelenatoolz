import "server-only";

import type { Permission } from "@/features/memberships/permissions";
import { isProducerRole } from "@/features/roles/role-rules";

/**
 * Кто что может со сметами цехов. Всё, что касается прав на сметы, проверяется
 * только этими функциями — на страницах и в серверных действиях.
 */
export type SmetaAccessContext = {
  role: { isSystem: boolean; name: string };
  can: (permission: Permission) => boolean;
  headDepartmentIds: readonly string[];
};

/** Видеть все сметы: продюсер или флаг «Сметы — просмотр всех». */
export function canReadAllSmeta(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role) || ctx.can("smeta:read_all");
}

/** Видеть смету цеха: продюсер, флаг или глава этого цеха. */
export function canReadDepartmentSmeta(
  ctx: SmetaAccessContext,
  departmentId: string,
): boolean {
  return canReadAllSmeta(ctx) || ctx.headDepartmentIds.includes(departmentId);
}

/** Открыть раздел «Сметы» вообще: видит все или глава хотя бы одного цеха. */
export function canOpenSmeta(ctx: SmetaAccessContext): boolean {
  return canReadAllSmeta(ctx) || ctx.headDepartmentIds.length > 0;
}

/** Править смету цеха: только глава этого цеха (продюсер листы цехов не правит). */
export function canEditDepartmentSmeta(
  ctx: SmetaAccessContext,
  departmentId: string,
): boolean {
  return ctx.headDepartmentIds.includes(departmentId);
}

/** Утверждать и возвращать сметы: только продюсер. */
export function canApproveSmeta(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role);
}

/** Управлять цехами (создать, изменить, упорядочить, удалить, назначить глав). */
export function canManageDepartments(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role) || ctx.can("members:manage");
}
