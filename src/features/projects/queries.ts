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
        include: {
          role: true,
          departmentHeads: { select: { departmentId: true } },
        },
      },
    },
  });
}

/** Какие цифры «Обзора» видны пользователю — по тем же условиям, что пункты меню. */
export type OverviewStatsVisibility = {
  scenes: boolean;
  locations: boolean;
  characters: boolean;
  schedule: boolean;
};

/**
 * Цифры «Обзора». Скрытые правами не запрашиваются из базы — вместо них `null`.
 */
export async function getOverviewStats(
  projectId: string,
  show: OverviewStatsVisibility,
) {
  const countIf = (visible: boolean, count: () => Promise<number>) =>
    visible ? count() : Promise.resolve(null);
  const [scenes, locations, characters, days, plannedScenes, totalScenes] =
    await Promise.all([
      countIf(show.scenes, () =>
        prisma.scene.count({ where: { projectId, cutAt: null } }),
      ),
      countIf(show.locations, () => prisma.location.count({ where: { projectId } })),
      countIf(show.characters, () => prisma.character.count({ where: { projectId } })),
      countIf(show.schedule, () => prisma.shootDay.count({ where: { projectId } })),
      // Сцены в плане и всего — без вырезанных
      countIf(show.schedule, () =>
        prisma.shootDayScene.count({
          where: { shootDay: { projectId }, scene: { cutAt: null } },
        }),
      ),
      countIf(show.schedule, () =>
        prisma.scene.count({ where: { projectId, cutAt: null } }),
      ),
    ]);
  return { scenes, locations, characters, days, plannedScenes, totalScenes };
}
