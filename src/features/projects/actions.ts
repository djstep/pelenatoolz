"use server";

import { MembershipStatus, ProjectStatus, ProjectType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/features/auth/session";
import {
  createInviteSchema,
  createProjectSchema,
  deleteProjectSchema,
  updateMemberRoleSchema,
  updateProjectSchema,
} from "@/features/projects/schemas";
import { canManageMembers } from "@/features/memberships/permissions";
import { requireProjectAccess, listProjectRoles } from "@/features/memberships/queries";
import { prisma } from "@/shared/db/prisma";
import { getDefaultProjectRoles } from "@/features/roles/default-roles";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { nanoid } from "nanoid";

export type ActionState = {
  error?: string;
  success?: string;
  inviteUrl?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseDate(value?: string) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseProjectFormData(formData: FormData) {
  const type = formData.get("type") as ProjectType | null;
  return {
    name: formData.get("name"),
    fullName: formData.get("fullName") || undefined,
    description: formData.get("description") || undefined,
    type: type || undefined,
    status: formData.get("status") || undefined,
    currency: formData.get("currency") || undefined,
    timezone: formData.get("timezone") || undefined,
    city: formData.get("city") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    episodeCount: formData.get("episodeCount") || undefined,
    episodeRuntimeMin: formData.get("episodeRuntimeMin") || undefined,
    shootingDaysCount: formData.get("shootingDaysCount") || undefined,
    cameraUnits: formData.get("cameraUnits") || undefined,
    cameraCount: formData.get("cameraCount") || undefined,
    timingMode: formData.get("timingMode") || undefined,
    pageToMinuteRatio: formData.get("pageToMinuteRatio") || undefined,
    plannedDailyOutputMin: formData.get("plannedDailyOutputMin") || undefined,
    shootOnFilm: formData.get("shootOnFilm") ?? undefined,
    filmType: formData.get("filmType") || undefined,
    filmCoefficient: formData.get("filmCoefficient") || undefined,
    calcCalendarDays: formData.get("calcCalendarDays") ?? undefined,
  };
}

function revalidateProject(projectId: string) {
  revalidatePath("/ru/projects");
  revalidatePath(`/ru/projects/${projectId}`);
  revalidatePath(`/ru/projects/${projectId}/settings`);
}

export async function createProjectAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const type = formData.get("type") as ProjectType;

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    fullName: formData.get("fullName") || undefined,
    description: formData.get("description") || undefined,
    type,
    status: formData.get("status") || undefined,
    currency: formData.get("currency") || undefined,
    timezone: formData.get("timezone") || undefined,
    city: formData.get("city") || undefined,
    startDate: formData.get("startDate") || undefined,
    endDate: formData.get("endDate") || undefined,
    episodeCount: formData.get("episodeCount") || undefined,
    episodeRuntimeMin: formData.get("episodeRuntimeMin") || undefined,
    shootingDaysCount: formData.get("shootingDaysCount") || undefined,
    cameraUnits: formData.get("cameraUnits") || undefined,
    cameraCount: formData.get("cameraCount") || undefined,
    timingMode: formData.get("timingMode") || undefined,
    pageToMinuteRatio: formData.get("pageToMinuteRatio") || undefined,
    plannedDailyOutputMin: formData.get("plannedDailyOutputMin") || undefined,
    shootOnFilm: formData.get("shootOnFilm") ?? undefined,
    filmType: formData.get("filmType") || undefined,
    filmCoefficient: formData.get("filmCoefficient") || undefined,
    calcCalendarDays: formData.get("calcCalendarDays") ?? undefined,
  });

  if (!parsed.success) {
    return {
      error: "Проверьте данные проекта",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  if (type === ProjectType.SERIES && !parsed.data.episodeCount) {
    return { error: "Для сериала укажите количество серий" };
  }

  const defaultRoles = getDefaultProjectRoles();
  const producerRole = defaultRoles[0]!;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name: parsed.data.name,
        fullName: parsed.data.fullName,
        description: parsed.data.description,
        type: parsed.data.type,
        status: parsed.data.status ?? ProjectStatus.DRAFT,
        currency: parsed.data.currency ?? "RUB",
        timezone: parsed.data.timezone ?? "Europe/Moscow",
        city: parsed.data.city,
        startDate: parseDate(parsed.data.startDate),
        endDate: parseDate(parsed.data.endDate),
        episodeCount:
          parsed.data.type === ProjectType.SERIES
            ? parsed.data.episodeCount
            : null,
        episodeRuntimeMin:
          parsed.data.type === ProjectType.SERIES
            ? parsed.data.episodeRuntimeMin
            : null,
        shootingDaysCount: parsed.data.shootingDaysCount,
        cameraUnits: parsed.data.cameraUnits ?? 1,
        cameraCount: parsed.data.cameraCount ?? 1,
        timingMode: parsed.data.timingMode,
        pageToMinuteRatio: parsed.data.pageToMinuteRatio,
        plannedDailyOutputMin: parsed.data.plannedDailyOutputMin,
        shootOnFilm: parsed.data.shootOnFilm ?? false,
        filmType: parsed.data.filmType,
        filmCoefficient: parsed.data.filmCoefficient,
        calcCalendarDays: parsed.data.calcCalendarDays ?? true,
        createdById: user.id!,
      },
    });

    const roles = await Promise.all(
      defaultRoles.map((role) =>
        tx.projectRoleDefinition.create({
          data: {
            projectId: created.id,
            name: role.name,
            note: role.note,
            isSystem: role.isSystem,
            permissions: role.permissions,
          },
        }),
      ),
    );

    const producer = roles.find((r) => r.name === producerRole.name)!;

    await tx.projectMembership.create({
      data: {
        projectId: created.id,
        userId: user.id!,
        roleId: producer.id,
        status: MembershipStatus.ACTIVE,
      },
    });

    return created;
  });

  redirect(`/ru/projects/${project.id}`);
}

export async function updateProjectAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "project:write");

  const parsed = updateProjectSchema.safeParse(parseProjectFormData(formData));

  if (!parsed.success) {
    return { error: "Не удалось обновить проект" };
  }

  if (
    parsed.data.type === ProjectType.SERIES &&
    parsed.data.episodeCount === undefined
  ) {
    const current = await prisma.project.findUnique({ where: { id: projectId } });
    if (current?.type === ProjectType.SERIES && !current.episodeCount) {
      return { error: "Для сериала укажите количество серий" };
    }
  }

  const type = parsed.data.type;
  await prisma.project.update({
    where: { id: projectId },
    data: {
      ...parsed.data,
      startDate: parsed.data.startDate
        ? parseDate(parsed.data.startDate)
        : undefined,
      endDate: parsed.data.endDate ? parseDate(parsed.data.endDate) : undefined,
      episodeCount:
        type === ProjectType.SERIES
          ? parsed.data.episodeCount
          : type != null
            ? null
            : undefined,
      episodeRuntimeMin:
        type === ProjectType.SERIES
          ? parsed.data.episodeRuntimeMin
          : type != null
            ? null
            : undefined,
    },
  });

  await recordAudit({ user: { id: user.id! } }, {
    projectId,
    entityType: AuditEntityType.project,
    entityId: projectId,
    action: "UPDATE",
    summary: "Настройки проекта обновлены",
  });

  revalidateProject(projectId);
  return { success: "Проект сохранён" };
}

export async function archiveProjectAction(projectId: string): Promise<ActionState> {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "project:archive");

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { error: "Проект не найден" };
  if (project.status === ProjectStatus.ARCHIVED) {
    return { error: "Проект уже в архиве" };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.ARCHIVED },
  });

  await recordAudit({ user: { id: user.id! } }, {
    projectId,
    entityType: AuditEntityType.project,
    entityId: projectId,
    action: "UPDATE",
    summary: `Проект «${project.name}» архивирован`,
  });

  revalidateProject(projectId);
  return { success: "Проект архивирован" };
}

export async function restoreProjectAction(projectId: string): Promise<ActionState> {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "project:archive");

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { error: "Проект не найден" };
  if (project.status !== ProjectStatus.ARCHIVED) {
    return { error: "Проект не в архиве" };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.DRAFT },
  });

  await recordAudit({ user: { id: user.id! } }, {
    projectId,
    entityType: AuditEntityType.project,
    entityId: projectId,
    action: "UPDATE",
    summary: `Проект «${project.name}» восстановлен из архива`,
  });

  revalidateProject(projectId);
  return { success: "Проект восстановлен" };
}

export async function deleteProjectAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "project:archive");

  const parsed = deleteProjectSchema.safeParse({
    confirmName: formData.get("confirmName"),
  });
  if (!parsed.success) {
    return { error: "Введите название проекта для подтверждения" };
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) return { error: "Проект не найден" };

  if (parsed.data.confirmName !== project.name) {
    return { error: "Название не совпадает" };
  }

  await recordAudit({ user: { id: user.id! } }, {
    projectId: null,
    entityType: AuditEntityType.project,
    entityId: projectId,
    action: "DELETE",
    summary: `Удалён проект «${project.name}»`,
  });

  await prisma.project.delete({ where: { id: projectId } });

  revalidatePath("/ru/projects");
  redirect("/ru/projects");
}

export async function createInviteAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const membership = await requireProjectAccess(
    projectId,
    user.id!,
    "members:manage",
  );

  const matrix = parsePermissionMatrix(membership.role.permissions);
  if (!canManageMembers(matrix)) {
    return { error: "Недостаточно прав для приглашений" };
  }

  const parsed = createInviteSchema.safeParse({
    email: formData.get("email") ?? "",
    roleId: formData.get("roleId"),
    expiresInDays: formData.get("expiresInDays") || 7,
  });

  if (!parsed.success) {
    return {
      error: "Проверьте параметры приглашения",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const roleExists = await prisma.projectRoleDefinition.findFirst({
    where: { id: parsed.data.roleId, projectId },
  });
  if (!roleExists) {
    return { error: "Роль не найдена" };
  }

  const token = nanoid(32);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsed.data.expiresInDays);

  const email = parsed.data.email?.toLowerCase() ?? null;

  await prisma.projectInvite.create({
    data: {
      projectId,
      email,
      roleId: parsed.data.roleId,
      token,
      expiresAt,
      createdById: user.id!,
    },
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const inviteUrl = `${appUrl}/ru/invite/${token}`;

  revalidatePath(`/ru/projects/${projectId}/members`);
  return {
    success: "Ссылка-приглашение создана",
    inviteUrl,
  };
}

export async function revokeInviteAction(inviteId: string, projectId: string) {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "members:manage");

  await prisma.projectInvite.updateMany({
    where: { id: inviteId, projectId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });

  revalidatePath(`/ru/projects/${projectId}/members`);
}

export async function updateMemberRoleAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "members:manage");

  const parsed = updateMemberRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { error: "Некорректные данные роли" };
  }

  const target = await prisma.projectMembership.findFirst({
    where: { id: parsed.data.membershipId, projectId },
    include: { role: true },
  });

  if (!target) {
    return { error: "Участник не найден" };
  }

  const newRole = await prisma.projectRoleDefinition.findFirst({
    where: { id: parsed.data.roleId, projectId },
  });
  if (!newRole) {
    return { error: "Роль не найдена" };
  }

  const producerRoles = await prisma.projectRoleDefinition.findMany({
    where: { projectId, isSystem: true, name: "Продюсер" },
  });
  const producerRoleId = producerRoles[0]?.id;

  if (
    target.userId === user.id &&
    producerRoleId &&
    parsed.data.roleId !== producerRoleId
  ) {
    const producers = await prisma.projectMembership.count({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
        roleId: producerRoleId,
      },
    });
    if (producers <= 1) {
      return { error: "В проекте должен остаться хотя бы один продюсер" };
    }
  }

  await prisma.projectMembership.update({
    where: { id: target.id },
    data: { roleId: parsed.data.roleId },
  });

  revalidatePath(`/ru/projects/${projectId}/members`);
  return { success: "Роль обновлена" };
}

export async function removeMemberAction(
  membershipId: string,
  projectId: string,
) {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "members:manage");

  const target = await prisma.projectMembership.findFirst({
    where: { id: membershipId, projectId },
    include: { role: true },
  });

  if (!target) {
    return;
  }

  if (target.userId === user.id) {
    throw new Error("Cannot remove yourself via this action");
  }

  const producerRole = await prisma.projectRoleDefinition.findFirst({
    where: { projectId, isSystem: true, name: "Продюсер" },
  });

  if (producerRole && target.roleId === producerRole.id) {
    const producers = await prisma.projectMembership.count({
      where: {
        projectId,
        status: MembershipStatus.ACTIVE,
        roleId: producerRole.id,
      },
    });
    if (producers <= 1) {
      throw new Error("Last producer cannot be removed");
    }
  }

  await prisma.projectMembership.update({
    where: { id: membershipId },
    data: { status: MembershipStatus.REMOVED },
  });

  revalidatePath(`/ru/projects/${projectId}/members`);
}

export async function acceptInviteAction(token: string): Promise<ActionState> {
  const user = await requireUser();

  const invite = await prisma.projectInvite.findUnique({
    where: { token },
    include: { project: true, role: true },
  });

  if (!invite || invite.revokedAt || invite.acceptedAt) {
    return { error: "Приглашение недействительно" };
  }

  if (invite.expiresAt < new Date()) {
    return { error: "Срок действия приглашения истёк" };
  }

  if (invite.email && invite.email !== user.email?.toLowerCase()) {
    return {
      error: `Это приглашение предназначено для ${invite.email}`,
    };
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectMembership.findUnique({
      where: {
        projectId_userId: {
          projectId: invite.projectId,
          userId: user.id!,
        },
      },
    });

    if (existing) {
      await tx.projectMembership.update({
        where: { id: existing.id },
        data: {
          status: MembershipStatus.ACTIVE,
          roleId: invite.roleId,
        },
      });
    } else {
      await tx.projectMembership.create({
        data: {
          projectId: invite.projectId,
          userId: user.id!,
          roleId: invite.roleId,
          status: MembershipStatus.ACTIVE,
        },
      });
    }

    await tx.projectInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
  });

  redirect(`/ru/projects/${invite.projectId}`);
}

export { listProjectRoles };
