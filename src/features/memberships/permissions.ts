import {
  can,
  type PermissionMatrix,
  type PermissionSectionId,
} from "@/features/roles/permissions-matrix";

export const PERMISSIONS = [
  "project:read",
  "project:write",
  "project:archive",
  "members:read",
  "members:manage",
  "script:read",
  "script:write",
  "schedule:read",
  "schedule:write",
  "callsheet:read",
  "callsheet:write",
  "cast:read",
  "cast:write",
  "budget:read",
  "budget:write",
  "smeta:read_all",
  "report:read",
  "report:write",
  "finance:read",
  "finance:write",
  "finance:unlock",
  "contracts:read",
  "contracts:write",
  "post:read",
  "post:write",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_TO_SECTION: Record<
  Permission,
  {
    section: PermissionSectionId;
    action:
      | "read"
      | "write"
      | "manage"
      | "finance"
      | "financeWrite"
      | "financeUnlock";
  }
> = {
  "project:read": { section: "project_settings", action: "read" },
  "project:write": { section: "project_settings", action: "write" },
  "project:archive": { section: "project_settings", action: "manage" },
  "members:read": { section: "members", action: "read" },
  "members:manage": { section: "members", action: "manage" },
  "script:read": { section: "scenes", action: "read" },
  "script:write": { section: "scenes", action: "write" },
  "schedule:read": { section: "schedule", action: "read" },
  "schedule:write": { section: "schedule", action: "write" },
  "callsheet:read": { section: "schedule", action: "read" },
  "callsheet:write": { section: "schedule", action: "write" },
  "cast:read": { section: "actors", action: "read" },
  "cast:write": { section: "actors", action: "write" },
  /** Смета: фин. просмотр / фин. редактирование в матрице раздела «Смета» */
  "budget:read": { section: "budget", action: "finance" },
  "budget:write": { section: "budget", action: "financeWrite" },
  /** Сметы цехов: просмотр всех (без правки и утверждения). Продюсер видит их и без флага. */
  "smeta:read_all": { section: "smeta_all", action: "read" },
  "report:read": { section: "reports", action: "read" },
  "report:write": { section: "reports", action: "write" },
  "finance:read": { section: "finance", action: "finance" },
  "finance:write": { section: "finance", action: "write" },
  "finance:unlock": { section: "finance", action: "financeUnlock" },
  /** Договоры и акты. Суммы в них дополнительно требуют прав раздела «Финансы». */
  "contracts:read": { section: "contracts", action: "read" },
  "contracts:write": { section: "contracts", action: "write" },
  "post:read": { section: "post", action: "read" },
  "post:write": { section: "post", action: "write" },
};

export function hasPermission(
  matrix: PermissionMatrix,
  permission: Permission,
): boolean {
  const mapping = PERMISSION_TO_SECTION[permission];
  return can(matrix, mapping.section, mapping.action);
}

export function canManageMembers(matrix: PermissionMatrix): boolean {
  return hasPermission(matrix, "members:manage");
}
