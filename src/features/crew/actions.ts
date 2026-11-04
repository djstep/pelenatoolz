"use server";

import { revalidatePath } from "next/cache";
import {
  crewAuditChanges,
  crewFullName,
  crewRights,
  crewWriteData,
} from "@/features/crew/lib/crew-rules";
import { crewMemberFormSchema, reorderCrewSchema } from "@/features/crew/schemas";
import { nextCrewSortOrder } from "@/features/crew/sort-order";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { auditMutation, recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

export type CrewActionState = {
  error?: string;
  success?: string;
};

const NO_RIGHTS = "Недостаточно прав";
const NOT_FOUND = "Человек не найден";
const DEPARTMENT_NOT_FOUND = "Цех не найден";

function revalidateCrew(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/crew`);
}

function parseForm(formData: FormData) {
  return crewMemberFormSchema.safeParse({
    lastName: formData.get("lastName") ?? "",
    firstName: formData.get("firstName"),
    middleName: formData.get("middleName"),
    position: formData.get("position"),
    departmentId: formData.get("departmentId"),
    note: formData.get("note"),
    phone: formData.get("phone"),
    email: formData.get("email"),
  });
}

export async function createCrewMemberAction(
  projectId: string,
  _prev: CrewActionState,
  formData: FormData,
): Promise<CrewActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("crew:write")) return { error: NO_RIGHTS };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  try {
    await assertInProject("Department", parsed.data.departmentId ?? "", projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: DEPARTMENT_NOT_FOUND };
    throw error;
  }

  const data = crewWriteData(parsed.data, crewRights(ctx.can));
  const sortOrder = await nextCrewSortOrder(prisma, projectId, data.departmentId);

  await auditMutation(
    ctx,
    () =>
      prisma.crewMember.create({
        data: { ...data, projectId, sortOrder, createdById: ctx.user.id! },
        select: { id: true },
      }),
    null,
    {
      projectId,
      entityType: AuditEntityType.crewMember,
      action: "CREATE",
      entityId: (_, row) => row.id,
      summary: `Добавлен в команду вручную: ${crewFullName(data)}`,
    },
  );

  revalidateCrew(projectId);
  return { success: "Человек добавлен" };
}

export async function updateCrewMemberAction(
  projectId: string,
  memberId: string,
  _prev: CrewActionState,
  formData: FormData,
): Promise<CrewActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("crew:write")) return { error: NO_RIGHTS };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте данные" };
  }

  try {
    await assertInProject("CrewMember", memberId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }
  try {
    await assertInProject("Department", parsed.data.departmentId ?? "", projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: DEPARTMENT_NOT_FOUND };
    throw error;
  }

  const before = await prisma.crewMember.findFirstOrThrow({
    where: { id: memberId, projectId },
    include: { department: { select: { name: true } } },
  });
  const data = crewWriteData(parsed.data, crewRights(ctx.can));
  const { departmentId, ...fields } = data;
  const moved = departmentId !== before.departmentId;
  const sortOrder = moved
    ? await nextCrewSortOrder(prisma, projectId, departmentId)
    : before.sortOrder;
  const department = departmentId
    ? await prisma.department.findFirst({
        where: { id: departmentId, projectId },
        select: { name: true },
      })
    : null;

  await auditMutation(
    ctx,
    () =>
      prisma.crewMember.update({
        where: { id: memberId, projectId },
        data: { ...data, sortOrder },
        select: { id: true },
      }),
    null,
    {
      projectId,
      entityType: AuditEntityType.crewMember,
      action: "UPDATE",
      entityId: memberId,
      summary: `Изменён человек команды: ${crewFullName(data)}`,
      changes: crewAuditChanges(
        { ...before, department: before.department?.name ?? null },
        { ...fields, department: department?.name ?? null },
      ),
    },
  );

  revalidateCrew(projectId);
  return { success: "Сохранено" };
}

async function setArchived(
  projectId: string,
  memberId: string,
  archived: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("crew:write")) return { error: NO_RIGHTS };

  const member = await prisma.crewMember.findFirst({
    where: { id: memberId, projectId },
    select: { lastName: true, firstName: true, middleName: true },
  });
  if (!member) return { error: NOT_FOUND };

  await auditMutation(
    ctx,
    () =>
      prisma.crewMember.update({
        where: { id: memberId, projectId },
        data: { archivedAt: archived ? new Date() : null },
        select: { id: true },
      }),
    null,
    {
      projectId,
      entityType: AuditEntityType.crewMember,
      action: "UPDATE",
      entityId: memberId,
      summary: `${archived ? "В архив" : "Возвращён из архива"}: ${crewFullName(member)}`,
    },
  );

  revalidateCrew(projectId);
  return {};
}

export async function archiveCrewMemberAction(projectId: string, memberId: string) {
  return setArchived(projectId, memberId, true);
}

export async function restoreCrewMemberAction(projectId: string, memberId: string) {
  return setArchived(projectId, memberId, false);
}

/** Порядок людей внутри одного цеха. Людей из разных цехов в одном запросе быть не может. */
export async function reorderCrewAction(
  projectId: string,
  orderedIds: unknown,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!ctx.can("crew:write")) return { error: NO_RIGHTS };

  const parsed = reorderCrewSchema.safeParse(orderedIds);
  if (!parsed.success) return { error: "Некорректный порядок" };
  const ids = [...new Set(parsed.data)];

  const rows = await prisma.crewMember.findMany({
    where: { id: { in: ids }, projectId },
    select: {
      id: true,
      departmentId: true,
      lastName: true,
      firstName: true,
      middleName: true,
      sortOrder: true,
      department: { select: { name: true } },
    },
  });
  if (rows.length !== ids.length) return { error: NOT_FOUND };
  if (new Set(rows.map((r) => r.departmentId)).size > 1) {
    return { error: "Порядок меняется только внутри цеха" };
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      // С 1, а не с 0: иначе первый в цехе снова выглядит как «порядок не меняли».
      prisma.crewMember.update({ where: { id, projectId }, data: { sortOrder: index + 1 } }),
    ),
  );

  const names = new Map(rows.map((r) => [r.id, crewFullName(r)]));
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.crewMember,
    entityId: projectId,
    action: "UPDATE",
    summary: `Изменён порядок людей: ${rows[0]?.department?.name ?? "без цеха"}`,
    changes: {
      from: [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map(crewFullName),
      to: ids.map((id) => names.get(id) ?? id),
    },
  });

  revalidateCrew(projectId);
  return {};
}
