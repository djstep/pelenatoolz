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

/** Утверждать сметы (и утверждать пересчёт по переменным): только продюсер. */
export function canApproveSmeta(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role);
}

/**
 * Вернуть смету главе с комментарием: продюсер или «Сметы — вернуть на доработку» —
 * только ту смету, которую видишь.
 */
export function canReturnSmeta(ctx: SmetaAccessContext, departmentId: string): boolean {
  if (isProducerRole(ctx.role)) return true;
  return ctx.can("smeta:return") && canReadDepartmentSmeta(ctx, departmentId);
}

/** Управлять цехами (создать, изменить, упорядочить, удалить, назначить глав). */
export function canManageDepartments(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role) || ctx.can("members:manage");
}

/** Вести общий шаблон статей фильма (добавить, переименовать, переставить, в архив): только продюсер. */
export function canEditBudgetTemplate(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role);
}

/**
 * Менять справочники сметы — переменные, типы расходов, формы оплаты, сопоставление типов
 * контрагентов, резерв и агентские: продюсер и роль с «Сметы — настройки». Правка начислений и
 * платежей («Финансы») сюда не входит. Главы цехов только видят.
 */
export function canEditBudgetDictionaries(ctx: SmetaAccessContext): boolean {
  return isProducerRole(ctx.role) || ctx.can("smeta:settings");
}
