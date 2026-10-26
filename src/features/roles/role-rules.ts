import "server-only";

import { MembershipStatus } from "@prisma/client";
import { DEFAULT_ROLE_NAMES } from "@/features/roles/default-roles";
import {
  parsePermissionMatrix,
  parseResourceCategoryFinance,
  PERMISSION_FLAGS,
  PERMISSION_SECTIONS,
  resolveCategoryFinance,
} from "@/features/roles/permissions-matrix";
import { prisma } from "@/shared/db/prisma";

type RoleLike = { isSystem: boolean; name: string };

/** Продюсер — системная роль с названием «Продюсер». Обычная роль с таким именем продюсером не считается. */
export function isProducerRole(role: RoleLike): boolean {
  return role.isSystem && role.name === DEFAULT_ROLE_NAMES.producer;
}

function normalizeRoleName(name: string) {
  return name.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
}

/** Имена системных ролей заняты: обычную роль так назвать нельзя, в любом регистре. */
export function isReservedRoleName(name: string): boolean {
  const normalized = normalizeRoleName(name);
  return Object.values(DEFAULT_ROLE_NAMES).some(
    (reserved) => normalizeRoleName(reserved) === normalized,
  );
}

/**
 * Права target не шире прав actor: каждый включённый флаг target включён и у actor.
 * Сравниваются матрицы из базы и финансовые права по категориям ресурсов
 * (категория без своей настройки у actor берёт раздел «Прочие ресурсы»).
 */
export function isPermissionSubset(
  targetPermissions: unknown,
  actorPermissions: unknown,
): boolean {
  const target = parsePermissionMatrix(targetPermissions);
  const actor = parsePermissionMatrix(actorPermissions);
  for (const section of PERMISSION_SECTIONS) {
    const own = actor[section.id];
    for (const flag of PERMISSION_FLAGS) {
      if (!target[section.id][flag]) continue;
      // Финансовая запись включает просмотр — так же считает can().
      if (flag === "financeRead" && own.financeWrite) continue;
      if (!own[flag]) return false;
    }
  }

  const targetCategories = parseResourceCategoryFinance(targetPermissions);
  const actorCategories = parseResourceCategoryFinance(actorPermissions);
  for (const [categoryId, perms] of Object.entries(targetCategories)) {
    const allowed = resolveCategoryFinance(actor, actorCategories, categoryId);
    if (perms.financeRead && !(allowed.financeRead || allowed.financeWrite)) {
      return false;
    }
    if (perms.financeWrite && !allowed.financeWrite) return false;
  }
  return true;
}

/** Продюсер может всё; остальные — только в пределах своих прав. */
export function canGrantPermissions(
  actorRole: RoleLike & { permissions: unknown },
  targetPermissions: unknown,
): boolean {
  if (isProducerRole(actorRole)) return true;
  return isPermissionSubset(targetPermissions, actorRole.permissions);
}

/** Сколько активных участников с системной ролью «Продюсер» в проекте. */
export async function countActiveProducers(projectId: string): Promise<number> {
  return prisma.projectMembership.count({
    where: {
      projectId,
      status: MembershipStatus.ACTIVE,
      role: { isSystem: true, name: DEFAULT_ROLE_NAMES.producer },
    },
  });
}
