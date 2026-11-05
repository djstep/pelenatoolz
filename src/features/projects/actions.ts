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
import { inviteOrigin } from "@/features/memberships/lib/invite-origin";
import { canManageMembers } from "@/features/memberships/permissions";
import { MEMBERS_PAGES_PERMISSION } from "@/features/memberships/lib/members-pages-access";
import {
  requireProjectAccess,
  listProjectRoles as queryProjectRoles,
} from "@/features/memberships/queries";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import {
  deleteProjectRefusal,
  isProjectOwner,
  lockProjectOwner,
  memberChangeRefusal,
  OWNER_ONLY_TRANSFER_ERROR,
  projectCreatedAuditMeta,
  transferRefusal,
} from "@/features/projects/lib/owner";
import { prisma } from "@/shared/db/prisma";
import { clearEmptied } from "@/shared/lib/cleared-fields";
import { scheduleProjectDriveAccessSync } from "@/features/cloud/lib/drive-access-sync";
import {
  detachProjectDriveIfKeeperLeft,
  revokeProjectDriveTokens,
} from "@/features/cloud/lib/project-drive-service";
import { DEFAULT_APPROVAL_STATUSES } from "@/features/finance/lib/approval-statuses";
import { DEFAULT_LEDGER_TYPES } from "@/features/contracts/lib/vat";
import { getDefaultProjectRoles } from "@/features/roles/default-roles";
import { parsePermissionMatrix } from "@/features/roles/permissions-matrix";
import {
  canGrantPermissions,
  countActiveProducers,
  isProducerRole,
} from "@/features/roles/role-rules";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMemberName } from "@/shared/audit/member-name";
import { auditMutation, recordAudit } from "@/shared/audit/with-audit";
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

function clearableDate(value: string | null | undefined) {
  return value === null ? null : parseDate(value);
}

const PROJECT_CLEARABLE = [
  "fullName",
  "description",
  "city",
  "startDate",
  "endDate",
  "episodeCount",
  "episodeRuntimeMin",
  "shootingDaysCount",
  "cameraUnits",
  "cameraCount",
  "plannedDailyOutputMin",
  "filmType",
  "filmCoefficient",
] as const;

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
        ownerUserId: user.id!,
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

    await tx.projectApprovalStatus.createMany({
      data: DEFAULT_APPROVAL_STATUSES.map((s) => ({
        projectId: created.id,
        key: s.key,
        name: s.name,
        color: s.color,
        isSystem: true,
        sortOrder: s.sortOrder,
      })),
    });

    await tx.projectLedgerType.createMany({
      data: DEFAULT_LEDGER_TYPES.map((t) => ({
        projectId: created.id,
        name: t.name,
        isSystem: true,
        sortOrder: t.sortOrder,
      })),
    });

    const producer = roles.find((r) => r.name === producerRole.name)!;

    // Создатель — участник с ролью «Продюсер» и владелец. Запись журнала — в этой же
    // транзакции: создание откатилось — записи нет; запись не легла — нет и проекта.
    const owner = await tx.user.findUnique({
      where: { id: user.id! },
      select: { name: true },
    });
    await auditMutation(
      { user: { id: user.id! } },
      () =>
        tx.projectMembership.create({
          data: {
            projectId: created.id,
            userId: user.id!,
            roleId: producer.id,
            status: MembershipStatus.ACTIVE,
          },
        }),
      null,
      projectCreatedAuditMeta({
        projectId: created.id,
        projectName: created.name,
        ownerUserId: user.id!,
        ownerName: owner?.name,
        roleId: producer.id,
        roleName: producer.name,
      }),
      { db: tx },
    );

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

  const data = clearEmptied(parsed.data, formData, PROJECT_CLEARABLE);
  if (data.type === ProjectType.SERIES && data.episodeCount === null) {
    return { error: "Для сериала укажите количество серий" };
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
      ...data,
      startDate: clearableDate(data.startDate),
      endDate: clearableDate(data.endDate),
      episodeCount:
        type === ProjectType.SERIES
          ? data.episodeCount
          : type != null
            ? null
            : undefined,
      episodeRuntimeMin:
        type === ProjectType.SERIES
          ? data.episodeRuntimeMin
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

  // Владелец проверяется под блокировкой: передача владения в другой вкладке не проскочит.
  // Запись журнала — в той же транзакции: удаление не прошло — записи нет.
  const refusal = await prisma.$transaction(
    async (tx) => {
      const ownerUserId = await lockProjectOwner(tx, projectId);
      const notOwner = deleteProjectRefusal(user.id!, ownerUserId);
      if (notOwner) return notOwner;
      await auditMutation(
        { user: { id: user.id! } },
        () => tx.project.delete({ where: { id: projectId } }),
        null,
        {
          projectId: null,
          entityType: AuditEntityType.project,
          entityId: projectId,
          action: "DELETE",
          summary: `Удалён проект «${project.name}»`,
        },
        { db: tx },
      );
      return null;
    },
    // Каскад по всем данным проекта может идти дольше 5 с по умолчанию.
    { timeout: 60_000 },
  );
  if (refusal) return { error: refusal };

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
  if (!canGrantPermissions(membership.role, roleExists.permissions)) {
    return { error: "Нельзя пригласить с правами шире ваших собственных" };
  }

  const token = nanoid(32);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsed.data.expiresInDays);

  const email = parsed.data.email?.toLowerCase() ?? null;

  const invite = await prisma.projectInvite.create({
    data: {
      projectId,
      email,
      roleId: parsed.data.roleId,
      token,
      expiresAt,
      createdById: user.id!,
    },
    select: { id: true },
  });

  await recordAudit({ user: { id: user.id! } }, {
    projectId,
    entityType: AuditEntityType.invite,
    entityId: invite.id,
    action: "CREATE",
    summary: `Создано приглашение с ролью «${roleExists.name}»`,
    changes: {
      roleId: roleExists.id,
      expiresAt: expiresAt.toISOString(),
      forSpecificEmail: email != null,
    },
  });

  const inviteUrl = `${await inviteOrigin()}/ru/invite/${token}`;

  revalidatePath(`/ru/projects/${projectId}/members`);
  return {
    success: "Ссылка-приглашение создана",
    inviteUrl,
  };
}

export async function revokeInviteAction(inviteId: string, projectId: string) {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, "members:manage");

  const revoked = await prisma.projectInvite.updateMany({
    where: { id: inviteId, projectId, acceptedAt: null },
    data: { revokedAt: new Date() },
  });

  if (revoked.count > 0) {
    await recordAudit({ user: { id: user.id! } }, {
      projectId,
      entityType: AuditEntityType.invite,
      entityId: inviteId,
      action: "UPDATE",
      summary: "Приглашение отозвано",
    });
  }

  revalidatePath(`/ru/projects/${projectId}/members`);
}

export async function updateMemberRoleAction(
  projectId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const actor = await requireProjectAccess(projectId, user.id!, "members:manage");

  const parsed = updateMemberRoleSchema.safeParse({
    membershipId: formData.get("membershipId"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { error: "Некорректные данные роли" };
  }

  const target = await prisma.projectMembership.findFirst({
    where: { id: parsed.data.membershipId, projectId },
    include: { role: true, user: { select: { name: true } } },
  });

  if (!target) {
    return { error: "Участник не найден" };
  }
  if (target.userId === user.id) {
    return { error: "Нельзя изменить свою роль" };
  }

  const newRole = await prisma.projectRoleDefinition.findFirst({
    where: { id: parsed.data.roleId, projectId },
  });
  if (!newRole) {
    return { error: "Роль не найдена" };
  }

  if (!canGrantPermissions(actor.role, target.role.permissions)) {
    return { error: "Нельзя менять роль участника с правами шире ваших" };
  }
  if (!canGrantPermissions(actor.role, newRole.permissions)) {
    return { error: "Нельзя выдать права шире ваших собственных" };
  }

  const memberName = auditMemberName(target.user.name);
  // Владелец и «последний продюсер» проверяются под блокировкой проекта —
  // одновременная передача владения или второе понижение ждут и видят результат.
  const outcome = await prisma.$transaction(async (tx) => {
    const ownerRefusal = memberChangeRefusal(
      target.userId,
      await lockProjectOwner(tx, projectId),
    );
    if (ownerRefusal) return { error: ownerRefusal };

    const current = await tx.projectMembership.findFirst({
      where: { id: target.id, projectId },
      include: { role: true },
    });
    if (!current) return { error: "Участник не найден" };
    if (
      current.status === MembershipStatus.ACTIVE &&
      isProducerRole(current.role) &&
      !isProducerRole(newRole) &&
      (await countActiveProducers(projectId, tx)) <= 1
    ) {
      return { error: "В проекте должен остаться хотя бы один продюсер" };
    }

    await auditMutation(
      { user: { id: user.id! } },
      () =>
        tx.projectMembership.update({
          where: { id: target.id, projectId },
          data: { roleId: newRole.id },
        }),
      null,
      {
        projectId,
        entityType: AuditEntityType.membership,
        entityId: target.id,
        action: "UPDATE",
        summary: `Роль участника «${memberName}» изменена: «${current.role.name}» → «${newRole.name}»`,
        changes: {
          userId: target.userId,
          memberName,
          roleId: { from: current.roleId, to: newRole.id },
          roleName: { from: current.role.name, to: newRole.name },
        },
      },
      { db: tx },
    );
    // Хранитель диска проекта больше не продюсер — диск отключается в этой же транзакции.
    const releasedDrive = await detachProjectDriveIfKeeperLeft(tx, {
      projectId,
      membershipId: target.id,
      actorUserId: user.id!,
    });
    return { releasedDrive };
  });
  if ("error" in outcome) return { error: outcome.error };
  // Отзыв у Google — после транзакции (и только если аккаунт больше нигде не подключён).
  await revokeProjectDriveTokens(outcome.releasedDrive);
  // Доступы к папкам диска проекта — после ответа (просмотр вызывных, продюсер).
  scheduleProjectDriveAccessSync(projectId, user.id!, "member_role");

  revalidatePath(`/ru/projects/${projectId}/members`);
  if (outcome.releasedDrive) revalidatePath(`/ru/projects/${projectId}`, "layout");
  return { success: "Роль обновлена" };
}

export async function removeMemberAction(
  membershipId: string,
  projectId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();
  const actor = await requireProjectAccess(projectId, user.id!, "members:manage");

  const target = await prisma.projectMembership.findFirst({
    where: { id: membershipId, projectId },
    include: { role: true, user: { select: { name: true } } },
  });

  if (!target) {
    return { error: "Участник не найден" };
  }

  if (target.userId === user.id) {
    return { error: "Себя из проекта так удалить нельзя" };
  }

  if (!canGrantPermissions(actor.role, target.role.permissions)) {
    return { error: "Нельзя удалить участника с правами шире ваших" };
  }

  const memberName = auditMemberName(target.user.name);
  // Владелец и «последний продюсер» — под блокировкой проекта, как при смене роли.
  const outcome = await prisma.$transaction(async (tx) => {
    const ownerRefusal = memberChangeRefusal(
      target.userId,
      await lockProjectOwner(tx, projectId),
    );
    if (ownerRefusal) return { error: ownerRefusal };

    const current = await tx.projectMembership.findFirst({
      where: { id: membershipId, projectId },
      include: { role: true },
    });
    if (!current) return { error: "Участник не найден" };
    if (
      current.status === MembershipStatus.ACTIVE &&
      isProducerRole(current.role) &&
      (await countActiveProducers(projectId, tx)) <= 1
    ) {
      return { error: "Это единственный продюсер проекта — удалить нельзя" };
    }

    // Удалённый участник перестаёт быть главой цехов: при повторном приглашении главу назначают заново.
    const removedHeads = await auditMutation(
      { user: { id: user.id! } },
      async () => {
        const heads = await tx.departmentHead.findMany({
          where: { membershipId, department: { projectId } },
          select: { department: { select: { id: true, name: true } } },
        });
        if (heads.length > 0) {
          await tx.departmentHead.deleteMany({
            where: { membershipId, department: { projectId } },
          });
        }
        await tx.projectMembership.update({
          where: { id: membershipId, projectId },
          data: { status: MembershipStatus.REMOVED },
        });
        return heads.map((h) => h.department);
      },
      null,
      {
        projectId,
        entityType: AuditEntityType.membership,
        entityId: target.id,
        action: "DELETE",
        summary: (_input, heads) =>
          heads.length > 0
            ? `Участник «${memberName}» с ролью «${current.role.name}» удалён из проекта и снят с глав цехов: ${heads.map((d) => `«${d.name}»`).join(", ")}`
            : `Участник «${memberName}» с ролью «${current.role.name}» удалён из проекта`,
        changes: (_input, heads) => ({
          userId: target.userId,
          memberName,
          roleId: current.roleId,
          roleName: current.role.name,
          ...(heads.length > 0 ? { removedFromDepartmentHeads: heads } : {}),
        }),
      },
      { db: tx },
    );
    // Удалён хранитель диска проекта — диск отключается в этой же транзакции.
    const releasedDrive = await detachProjectDriveIfKeeperLeft(tx, {
      projectId,
      membershipId,
      actorUserId: user.id!,
    });
    return { removedHeads, releasedDrive };
  });
  if ("error" in outcome) return { error: outcome.error };
  const { removedHeads, releasedDrive } = outcome;
  // Отзыв у Google — после транзакции (и только если аккаунт больше нигде не подключён).
  await revokeProjectDriveTokens(releasedDrive);
  // Снять доступы к папкам диска проекта — после ответа.
  scheduleProjectDriveAccessSync(projectId, user.id!, "member_removed");

  revalidatePath(`/ru/projects/${projectId}/members`);
  if (releasedDrive) revalidatePath(`/ru/projects/${projectId}`, "layout");
  if (removedHeads.length > 0) {
    revalidatePath(`/ru/projects/${projectId}/settings/departments`);
  }
  return {};
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

  // Активный участник не может сменить себе роль, приняв приглашение.
  const current = await prisma.projectMembership.findUnique({
    where: {
      projectId_userId: { projectId: invite.projectId, userId: user.id! },
    },
    select: { status: true },
  });
  if (current?.status === MembershipStatus.ACTIVE) {
    return { error: "Вы уже участник проекта" };
  }
  // Владелец всегда активный участник; проверка на случай, если это когда-то изменится.
  const ownerRefusal = memberChangeRefusal(user.id!, invite.project.ownerUserId);
  if (ownerRefusal) return { error: ownerRefusal };

  const { membershipId, previousRole } = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectMembership.findUnique({
      where: {
        projectId_userId: {
          projectId: invite.projectId,
          userId: user.id!,
        },
      },
      include: { role: { select: { id: true, name: true } } },
    });

    const membership = existing
      ? await tx.projectMembership.update({
          where: { id: existing.id },
          data: {
            status: MembershipStatus.ACTIVE,
            roleId: invite.roleId,
          },
        })
      : await tx.projectMembership.create({
          data: {
            projectId: invite.projectId,
            userId: user.id!,
            roleId: invite.roleId,
            status: MembershipStatus.ACTIVE,
          },
        });

    await tx.projectInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    // Прежняя запись участия — возврат в проект; роль до возврата пишется в журнал.
    return { membershipId: membership.id, previousRole: existing?.role ?? null };
  });

  // Возврат пишется тем же действием CREATE, что и первое принятие, — отличается по returned.
  await recordAudit({ user: { id: user.id! } }, {
    projectId: invite.projectId,
    entityType: AuditEntityType.membership,
    entityId: membershipId,
    action: "CREATE",
    summary: previousRole
      ? `Принято приглашение с ролью «${invite.role.name}» — возврат в проект (была роль «${previousRole.name}»)`
      : `Принято приглашение с ролью «${invite.role.name}»`,
    changes: {
      inviteId: invite.id,
      userId: user.id!,
      roleId: invite.roleId,
      roleName: invite.role.name,
      ...(previousRole
        ? {
            returned: true,
            previousRoleId: previousRole.id,
            previousRoleName: previousRole.name,
          }
        : {}),
    },
  });
  // Новый участник или возврат — доступы к уже созданным папкам диска проекта, после ответа.
  scheduleProjectDriveAccessSync(invite.projectId, user.id!, "member_joined");

  redirect(`/ru/projects/${invite.projectId}`);
}

/**
 * Передать владение проектом другому активному продюсеру.
 * Только владелец. Бывший владелец остаётся продюсером, дальше его можно понизить как любого.
 */
export async function transferOwnershipAction(
  projectId: string,
  membershipId: string,
): Promise<{ error?: string; success?: string }> {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!);
  if (typeof membershipId !== "string") return { error: "Участник не найден" };

  let outcome: { error: string } | { toName: string };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const ownerUserId = await lockProjectOwner(tx, projectId);
      // Не владелец получает отказ до поиска участника.
      if (!isProjectOwner(user.id!, ownerUserId)) {
        return { error: OWNER_ONLY_TRANSFER_ERROR };
      }

      await assertInProject("ProjectMembership", membershipId, projectId, tx);
      const [target, from] = await Promise.all([
        tx.projectMembership.findFirst({
          where: { id: membershipId, projectId, status: MembershipStatus.ACTIVE },
          include: { role: true, user: { select: { name: true } } },
        }),
        tx.projectMembership.findFirst({
          where: { projectId, userId: user.id!, status: MembershipStatus.ACTIVE },
          include: { role: true, user: { select: { name: true } } },
        }),
      ]);
      const refusal = transferRefusal({
        actorUserId: user.id!,
        ownerUserId,
        target: target && { userId: target.userId, isProducer: isProducerRole(target.role) },
      });
      if (refusal) return { error: refusal };
      if (!target || !from) return { error: "Участник не найден" };

      const fromName = auditMemberName(from.user.name);
      const toName = auditMemberName(target.user.name);
      await auditMutation(
        { user: { id: user.id! } },
        () =>
          tx.project.update({
            where: { id: projectId },
            data: { ownerUserId: target.userId },
          }),
        null,
        {
          projectId,
          entityType: AuditEntityType.membership,
          entityId: target.id,
          action: "UPDATE",
          summary: `Владение проектом передано: «${fromName}» → «${toName}»`,
          changes: {
            ownershipTransfer: true,
            fromUserId: from.userId,
            fromName,
            fromRoleName: from.role.name,
            toUserId: target.userId,
            toName,
            toPreviousRoleName: target.role.name,
          },
        },
        { db: tx },
      );
      return { toName };
    });
  } catch (error) {
    if (isNotInProjectError(error)) return { error: "Участник не найден" };
    throw error;
  }
  if ("error" in outcome) return { error: outcome.error };

  revalidatePath(`/ru/projects/${projectId}/members`);
  revalidatePath(`/ru/projects/${projectId}/settings`);
  return { success: `Владение передано: «${outcome.toName}»` };
}

/** Роли проекта — только активному участнику с просмотром «Участников». */
export async function listProjectRoles(projectId: string) {
  const user = await requireUser();
  await requireProjectAccess(projectId, user.id!, MEMBERS_PAGES_PERMISSION);
  return queryProjectRoles(projectId);
}
