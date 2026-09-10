"use server";

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
import { prisma } from "@/shared/db/prisma";
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

  const matrix = matrixFromFormData(formData);
  const categoryFinance = categoryFinanceFromFormData(
    formData,
    categoryIdsFromForm(formData),
  );
  const permissions = buildPermissionsDocument(matrix, categoryFinance);

  try {
    await prisma.projectRoleDefinition.create({
      data: {
        projectId,
        name: parsed.data.name,
        note: parsed.data.note,
        permissions,
      },
    });
  } catch {
    return { error: "Роль с таким названием уже существует" };
  }

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

  const parsed = roleSchema.safeParse({
    name: formData.get("name"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: "Укажите название роли" };
  }

  const matrix = matrixFromFormData(formData);
  const categoryFinance = categoryFinanceFromFormData(
    formData,
    categoryIdsFromForm(formData),
  );
  const permissions = buildPermissionsDocument(matrix, categoryFinance);

  try {
    await prisma.projectRoleDefinition.update({
      where: { id: roleId },
      data: {
        name: parsed.data.name,
        note: parsed.data.note,
        permissions,
      },
    });
  } catch {
    return { error: "Не удалось сохранить роль" };
  }

  revalidateRoles(projectId);
  return { success: "Роль сохранена" };
}

export async function deleteRoleAction(projectId: string, roleId: string) {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("members:manage")) {
    throw new Error("FORBIDDEN");
  }

  const role = await prisma.projectRoleDefinition.findFirst({
    where: { id: roleId, projectId },
  });
  if (!role || role.isSystem) {
    throw new Error("Cannot delete system role");
  }

  const inUse = await prisma.projectMembership.count({
    where: { roleId, projectId, status: "ACTIVE" },
  });
  if (inUse > 0) {
    throw new Error("Role in use");
  }

  await prisma.projectRoleDefinition.delete({ where: { id: roleId } });
  revalidateRoles(projectId);
}
