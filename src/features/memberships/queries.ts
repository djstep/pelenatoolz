import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";
import {
  canManageMembers,
  hasPermission,
  type Permission,
} from "@/features/memberships/permissions";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";

export async function getActiveMembership(projectId: string, userId: string) {
  return prisma.projectMembership.findFirst({
    where: {
      projectId,
      userId,
      status: MembershipStatus.ACTIVE,
    },
    include: { role: true },
  });
}

export async function requireProjectAccess(
  projectId: string,
  userId: string,
  permission: Permission = "project:read",
) {
  const membership = await getActiveMembership(projectId, userId);
  if (!membership) {
    throw new Error("FORBIDDEN");
  }
  const matrix = parsePermissionMatrix(membership.role.permissions);
  if (!hasPermission(matrix, permission)) {
    throw new Error("FORBIDDEN");
  }
  return membership;
}

export async function listProjectMembers(projectId: string) {
  return prisma.projectMembership.findMany({
    where: {
      projectId,
      status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      role: true,
    },
    orderBy: [{ role: { name: "asc" } }, { createdAt: "asc" }],
  });
}

export async function listProjectInvites(projectId: string) {
  return prisma.projectInvite.findMany({
    where: {
      projectId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { role: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function listProjectRoles(projectId: string) {
  return prisma.projectRoleDefinition.findMany({
    where: { projectId },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
}

export { canManageMembers };
