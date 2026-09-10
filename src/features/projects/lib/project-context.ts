import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import {
  hasPermission,
  type Permission,
} from "@/features/memberships/permissions";
import { getProjectForUser } from "@/features/projects/queries";
import {
  canEntityFinance,
  parsePermissionMatrix,
  parseResourceCategoryFinance,
  type EntityFinanceTarget,
} from "@/features/roles/permissions-matrix";

export async function requireProjectContext(projectId: string) {
  const user = await requireUser();
  const project = await getProjectForUser(projectId, user.id!);

  if (!project) {
    notFound();
  }

  const membership = project.memberships[0];
  if (!membership?.role) {
    notFound();
  }

  const rawPermissions = membership.role.permissions;
  const matrix = parsePermissionMatrix(rawPermissions);
  const categoryFinance = parseResourceCategoryFinance(rawPermissions);

  return {
    user,
    project,
    membership,
    role: membership.role,
    matrix,
    categoryFinance,
    can: (permission: Permission) => hasPermission(matrix, permission),
    canFinanceRead: (target: EntityFinanceTarget) =>
      canEntityFinance(matrix, categoryFinance, target, "read"),
    canFinanceWrite: (target: EntityFinanceTarget) =>
      canEntityFinance(matrix, categoryFinance, target, "write"),
  };
}
