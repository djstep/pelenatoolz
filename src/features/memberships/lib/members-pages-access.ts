import type { Permission } from "@/features/memberships/permissions";

/**
 * Право, по которому открываются страницы «Участники» и «Роли и права»
 * и действие `listProjectRoles`. Пункты меню (`project-nav-groups.ts`) видны по тому же
 * праву — расхождение ловит `members-pages-access.test.ts`.
 */
export const MEMBERS_PAGES_PERMISSION: Permission = "members:read";
