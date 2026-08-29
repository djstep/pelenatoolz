import { MembershipStatus, ProjectStatus } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

export async function listUserProjects(
  userId: string,
  options?: { includeArchived?: boolean },
) {
  return prisma.project.findMany({
    where: {
      memberships: {
        some: {
          userId,
          status: MembershipStatus.ACTIVE,
        },
      },
      ...(options?.includeArchived
        ? {}
        : { status: { not: ProjectStatus.ARCHIVED } }),
    },
    include: {
      memberships: {
        where: { userId, status: MembershipStatus.ACTIVE },
        take: 1,
        include: { role: true },
      },
      _count: {
        select: {
          memberships: {
            where: { status: MembershipStatus.ACTIVE },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getProjectForUser(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      memberships: {
        some: {
          userId,
          status: MembershipStatus.ACTIVE,
        },
      },
    },
    include: {
      memberships: {
        where: { userId, status: MembershipStatus.ACTIVE },
        take: 1,
        include: { role: true },
      },
    },
  });
}
