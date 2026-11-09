import { MembershipStatus, ProjectStatus } from "@prisma/client";
import {
  projectCardAccess,
  projectIdsForMembersCount,
  type ProjectCardAccess,
} from "@/features/projects/lib/project-list-access";
import { isProjectId } from "@/features/projects/lib/project-id";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";
import { prisma } from "@/shared/db/prisma";

/**
 * Проекты пользователя для списка. Число участников (`membersCount`) и «Настройки»
 * (`canOpenSettings`) — по правам роли в проекте (`projectCardAccess`); без права
 * «Участники: просмотр» число участников из базы не запрашивается (`null`).
 */
export async function listUserProjects(
  userId: string,
  options?: { includeArchived?: boolean },
) {
  const projects = await prisma.project.findMany({
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
    },
    orderBy: { updatedAt: "desc" },
  });

  const rows = projects.map((project) => {
    const role = project.memberships[0]?.role;
    const access: ProjectCardAccess = role
      ? projectCardAccess(parsePermissionMatrix(role.permissions))
      : { membersCount: false, settings: false };
    return { id: project.id, project, access };
  });

  const countIds = projectIdsForMembersCount(rows);
  const counts =
    countIds.length > 0
      ? await prisma.projectMembership.groupBy({
          by: ["projectId"],
          where: { projectId: { in: countIds }, status: MembershipStatus.ACTIVE },
          _count: { _all: true },
        })
      : [];
  const countById = new Map(counts.map((c) => [c.projectId, c._count._all]));

  return rows.map(({ project, access }) => ({
    ...project,
    membersCount: access.membersCount ? (countById.get(project.id) ?? 0) : null,
    canOpenSettings: access.settings,
  }));
}

export async function getProjectForUser(projectId: string, userId: string) {
  // id из адреса или запроса: объект-фильтр Prisma нашёл бы любой проект пользователя.
  if (!isProjectId(projectId)) return null;
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
