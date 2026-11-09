import { isProjectId } from "@/features/projects/lib/project-id";
import { prisma } from "@/shared/db/prisma";
import {
  parsePermissionMatrix,
  type PermissionMatrix,
  type PermissionSectionId,
} from "@/features/roles/permissions-matrix";
import { can } from "@/features/roles/permissions-matrix";

export async function getMembershipWithPermissions(
  projectId: string,
  userId: string,
) {
  // id из браузера: объект-фильтр Prisma нашёл бы участие в любом проекте пользователя.
  if (!isProjectId(projectId)) return null;
  return prisma.projectMembership.findFirst({
    where: {
      projectId,
      userId,
      status: "ACTIVE",
    },
    include: { role: true },
  });
}

export function getMatrixFromMembership(
  membership: { role: { permissions: unknown } } | null,
): PermissionMatrix | null {
  if (!membership) return null;
  return parsePermissionMatrix(membership.role.permissions);
}

export async function requireSectionAccess(
  projectId: string,
  userId: string,
  section: PermissionSectionId,
  action: "read" | "write" | "manage" | "finance" | "financeWrite" | "financeUnlock" = "read",
) {
  const membership = await getMembershipWithPermissions(projectId, userId);
  const matrix = getMatrixFromMembership(membership);
  if (!matrix || !can(matrix, section, action)) {
    throw new Error("FORBIDDEN");
  }
  return { membership: membership!, matrix };
}
