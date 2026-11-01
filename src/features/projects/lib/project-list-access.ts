import { MEMBERS_PAGES_PERMISSION } from "@/features/memberships/lib/members-pages-access";
import { hasPermission, type Permission } from "@/features/memberships/permissions";
import type { PermissionMatrix } from "@/features/roles/permissions-matrix";

/**
 * Страница «Настройки проекта» открывается с любым из этих прав (правка или архивирование).
 * По ним же — пункт меню и кнопка «Настройки» в списке проектов.
 */
export const PROJECT_SETTINGS_PAGE_PERMISSIONS: readonly Permission[] = [
  "project:write",
  "project:archive",
];

export function canOpenProjectSettings(can: (permission: Permission) => boolean): boolean {
  return PROJECT_SETTINGS_PAGE_PERMISSIONS.some((permission) => can(permission));
}

/**
 * Карточка проекта в списке — по тем же правам, что меню проекта: число участников —
 * с правом страницы «Участники», кнопка «Настройки» — с правом страницы настроек.
 * Расхождение с меню ловит `project-list-access.test.ts`.
 */
export type ProjectCardAccess = { membersCount: boolean; settings: boolean };

export function projectCardAccess(matrix: PermissionMatrix): ProjectCardAccess {
  const can = (permission: Permission) => hasPermission(matrix, permission);
  return {
    membersCount: can(MEMBERS_PAGES_PERMISSION),
    settings: canOpenProjectSettings(can),
  };
}

/** Проекты, где число участников запрашивается из базы: только с правом его видеть. */
export function projectIdsForMembersCount(
  rows: readonly { id: string; access: ProjectCardAccess }[],
): string[] {
  return rows.filter((row) => row.access.membersCount).map((row) => row.id);
}
