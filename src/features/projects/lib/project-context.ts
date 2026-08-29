import { notFound } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import {
  hasPermission,
  type Permission,
} from "@/features/memberships/permissions";
import { getProjectForUser } from "@/features/projects/queries";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";

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

  const matrix = parsePermissionMatrix(membership.role.permissions);

  return {
    user,
    project,
    membership,
    role: membership.role,
    matrix,
    can: (permission: Permission) => hasPermission(matrix, permission),
  };
}
