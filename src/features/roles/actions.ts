"use server";

import { MembershipStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  buildEmptyMatrix,
  buildPermissionsDocument,
  type CategoryFinancePermissions,
  type PermissionMatrix,
  PERMISSION_FLAGS,
  PERMISSION_SECTIONS,
} from "@/features/roles/permissions-matrix";
import {
  canGrantPermissions,
  isReservedRoleName,
} from "@/features/roles/role-rules";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { isForeignKeyError, LINKED_ERROR } from "@/shared/db/foreign-key";
import { prisma } from "@/shared/db/prisma";
import { impactLines, listCounts } from "@/shared/lib/plural";
import { DEFAULT_ROLE_NAMES } from "@/features/roles/default-roles";
import { z } from "zod";

export type RoleActionState = { error?: string; success?: string };

const roleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500).optional(),
});

function revalidateRoles(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/roles`);
  revalidatePath(`/ru/projects/${projectId}/members`);
  revalidatePath(`/ru/projects/${projectId}/resource-usage`);
  revalidatePath(`/ru/projects/${projectId}/settings/resources`);
  revalidatePath(`/ru/projects/${projectId}/characters`);
  revalidatePath(`/ru/projects/${projectId}/locations`);
}

function matrixFromFormData(formData: FormData): PermissionMatrix {
  const matrix = buildEmptyMatrix();
  for (const section of PERMISSION_SECTIONS) {
    for (const flag of PERMISSION_FLAGS) {
      const key = `perm_${section.id}_${flag}`;
      matrix[section.id][flag] = formData.get(key) === "on";
    }
  }
  return matrix;
}

function categoryFinanceFromFormData(
  formData: FormData,
  categoryIds: string[],
): Record<string, CategoryFinancePermissions> {
  const out: Record<string, CategoryFinancePermissions> = {};
  for (const id of categoryIds) {
    out[id] = {
      financeRead: formData.get(`catfin_${id}_financeRead`) === "on",
      financeWrite: formData.get(`catfin_${id}_financeWrite`) === "on",
    };
  }
  return out;
}

function categoryIdsFromForm(formData: FormData): string[] {
  const raw = String(formData.get("resourceCategoryIds") ?? "");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Только категории ресурсов этого проекта: чужие id в права роли не попадают. */
async function projectCategoryIdsFromForm(
  projectId: string,
  formData: FormData,
): Promise<string[]> {
  const ids = [...new Set(categoryIdsFromForm(formData))];
  if (ids.length === 0) return [];
  const rows = await prisma.resourceCategory.findMany({
    where: { projectId, id: { in: ids } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

const RESERVED_NAME_ERROR = "Это название зарезервировано для системной роли";
const GRANT_ERROR = "Нельзя выдать права шире ваших собственных";

export async function createRoleAction(
  projectId: string,
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("members:manage")) {
    return { error: "Недостаточно прав" };
  }

  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: "Укажите название роли" };
  }
  if (isReservedRoleName(parsed.data.name)) {
    return { error: RESERVED_NAME_ERROR };
  }

  const matrix = matrixFromFormData(formData);
  const categoryFinance = categoryFinanceFromFormData(
    formData,
    await projectCategoryIdsFromForm(projectId, formData),
  );
  const permissions = buildPermissionsDocument(matrix, categoryFinance);
  if (!canGrantPermissions(ctx.role, permissions)) {
    return { error: GRANT_ERROR };
  }

  let created: { id: string };
  try {
    created = await prisma.projectRoleDefinition.create({
      data: {
        projectId,
        name: parsed.data.name,
        note: parsed.data.note,
        permissions,
      },
      select: { id: true },
    });
  } catch {
    return { error: "Роль с таким названием уже существует" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.role,
    entityId: created.id,
    action: "CREATE",
    summary: `Создана роль «${parsed.data.name}»`,
  });

  revalidateRoles(projectId);
  return { success: "Роль создана" };
}

export async function updateRoleAction(
  projectId: string,
  roleId: string,
  _prev: RoleActionState,
  formData: FormData,
): Promise<RoleActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("members:manage")) {
    return { error: "Недостаточно прав" };
  }

  const role = await prisma.projectRoleDefinition.findFirst({
    where: { id: roleId, projectId },
  });
  if (!role) return { error: "Роль не найдена" };
  if (role.isSystem) return { error: "Системную роль изменить нельзя" };
  if (role.id === ctx.membership.roleId) {
    return { error: "Нельзя изменить роль, которая назначена вам" };
  }

  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: "Укажите название роли" };
  }
  if (isReservedRoleName(parsed.data.name)) {
    return { error: RESERVED_NAME_ERROR };
  }

  const matrix = matrixFromFormData(formData);
  const categoryFinance = categoryFinanceFromFormData(
    formData,
    await projectCategoryIdsFromForm(projectId, formData),
  );
  const permissions = buildPermissionsDocument(matrix, categoryFinance);
  if (!canGrantPermissions(ctx.role, permissions)) {
    return { error: GRANT_ERROR };
  }

  try {
    await prisma.projectRoleDefinition.update({
      where: { id: roleId, projectId },
      data: {
        name: parsed.data.name,
        note: parsed.data.note,
        permissions,
      },
    });
  } catch {
    return { error: "Не удалось сохранить роль" };
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.role,
    entityId: roleId,
    action: "UPDATE",
    summary:
      role.name === parsed.data.name
        ? `Изменена роль «${role.name}»`
        : `Изменена роль «${role.name}» → «${parsed.data.name}»`,
  });

  revalidateRoles(projectId);
  return { success: "Роль сохранена" };
}

export async function deleteRoleAction(
  projectId: string,
  roleId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("members:manage")) {
    return { error: "Недостаточно прав" };
  }

  const role = await prisma.projectRoleDefinition.findFirst({
    where: { id: roleId, projectId },
  });
  if (!role) return { error: "Роль не найдена" };
  if (role.isSystem) return { error: "Системную роль удалить нельзя" };

  // Действующие участники и действующие приглашения не дают удалить роль.
  const now = new Date();
  const usage = await roleUsage(projectId, roleId, now);
  if (usage.active + usage.activeInvites > 0) {
    return {
      error: `Роль используется: ${listCounts([
        [usage.active, ["участник", "участника", "участников"]],
        [usage.activeInvites, ["действующее приглашение", "действующих приглашения", "действующих приглашений"]],
      ])} — удалить нельзя`,
    };
  }

  // Бывшие участники (запись остаётся, роль в ней обязательна) переходят на «Наблюдателя»:
  // доступа у них нет, при возвращении по приглашению роль берётся из приглашения.
  let viewerId: string | null = null;
  if (usage.former > 0) {
    const viewer = await findViewerRole(projectId);
    if (!viewer) {
      return {
        error: "В проекте нет системной роли «Наблюдатель» — некуда перевести бывших участников с этой ролью, удалить нельзя",
      };
    }
    viewerId = viewer.id;
  }

  // Отменённые, просроченные и принятые приглашения уже отработали — удаляются вместе с ролью.
  let deletedInvites = 0;
  let movedMembers = 0;
  try {
    await prisma.$transaction(async (tx) => {
      if (viewerId) {
        const moved = await tx.projectMembership.updateMany({
          where: { roleId, projectId, status: MembershipStatus.REMOVED },
          data: { roleId: viewerId },
        });
        movedMembers = moved.count;
      }
      const deleted = await tx.projectInvite.deleteMany({
        where: { roleId, projectId, NOT: activeInviteWhere(now) },
      });
      deletedInvites = deleted.count;
      await tx.projectRoleDefinition.delete({ where: { id: roleId, projectId } });
    });
  } catch (error) {
    if (isForeignKeyError(error)) return { error: LINKED_ERROR };
    throw error;
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.role,
    entityId: roleId,
    action: "DELETE",
    summary: `Удалена роль «${role.name}»`,
    changes: {
      deletedInvites,
      formerMembersMovedToViewer: movedMembers,
    },
  });

  revalidateRoles(projectId);
  return {};
}

/** Приглашение действует: не принято, не отменено, срок не вышел. */
function activeInviteWhere(now: Date) {
  return { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } };
}

/** Кто ссылается на роль: действующие участники, бывшие, действующие и отработавшие приглашения. */
async function roleUsage(projectId: string, roleId: string, now: Date) {
  const [active, former, activeInvites, staleInvites] = await Promise.all([
    prisma.projectMembership.count({
      where: {
        roleId,
        projectId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
      },
    }),
    prisma.projectMembership.count({
      where: { roleId, projectId, status: MembershipStatus.REMOVED },
    }),
    prisma.projectInvite.count({ where: { roleId, projectId, ...activeInviteWhere(now) } }),
    prisma.projectInvite.count({
      where: { roleId, projectId, NOT: activeInviteWhere(now) },
    }),
  ]);
  return { active, former, activeInvites, staleInvites };
}

/** Системная роль «Наблюдатель» — так же, как «Продюсер»: системная и с зарезервированным названием. */
function findViewerRole(projectId: string) {
  return prisma.projectRoleDefinition.findFirst({
    where: { projectId, isSystem: true, name: DEFAULT_ROLE_NAMES.viewer },
    select: { id: true },
  });
}

/** Что произойдёт при удалении роли — для окна подтверждения. */
export async function getRoleDeleteImpactAction(
  projectId: string,
  roleId: string,
): Promise<string[]> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("members:manage")) return [];
  const usage = await roleUsage(projectId, roleId, new Date());
  if (usage.active + usage.activeInvites > 0) return [];
  return impactLines([
    [usage.staleInvites, "Удалятся отменённые, просроченные и принятые приглашения"],
    [usage.former, "Бывшие участники перейдут на роль «Наблюдатель»"],
  ]);
}
