"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  departmentFormSchema,
  reorderDepartmentsSchema,
} from "@/features/departments/schemas";
import { memberLabelsById } from "@/features/departments/queries";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isProducerRole } from "@/features/roles/role-rules";
import { canManageDepartments } from "@/features/smeta/lib/smeta-access";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";
import { prisma } from "@/shared/db/prisma";

/** Что ввёл человек — вернуть в окно при ошибке (React сбрасывает форму после отправки). */
export type DepartmentFormValues = {
  name: string;
  codePrefix: string;
  headMembershipIds: string[];
};

export type DepartmentActionState = {
  error?: string;
  success?: string;
  values?: DepartmentFormValues;
};

const NO_RIGHTS = "Недостаточно прав";
const NOT_FOUND = "Цех не найден";
const SELF_HEAD_ERROR = "Назначить главой себя может только продюсер";
const MEMBER_NOT_FOUND = "Участник не найден или не активен";
const DUPLICATE_ERROR = "Цех с таким названием или префиксом уже есть";

function revalidateDepartments(projectId: string) {
  revalidatePath(`/ru/projects/${projectId}/settings/departments`);
  revalidatePath(`/ru/projects/${projectId}/smeta`);
  // Меню «Сметы» зависит от того, глава ли пользователь.
  revalidatePath(`/ru/projects/${projectId}`, "layout");
}

function isUniqueError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function parseForm(formData: FormData) {
  return departmentFormSchema.safeParse({
    name: formData.get("name"),
    codePrefix: formData.get("codePrefix") ?? "",
    headMembershipIds: [
      ...new Set(formData.getAll("headMembershipIds").map((v) => String(v))),
    ],
  });
}

function formValues(formData: FormData): DepartmentFormValues {
  return {
    name: String(formData.get("name") ?? "").slice(0, 100),
    codePrefix: String(formData.get("codePrefix") ?? "").slice(0, 6),
    headMembershipIds: formData
      .getAll("headMembershipIds")
      .map((v) => String(v))
      .slice(0, 100),
  };
}

function firstIssue(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Некорректные данные";
}

type Ctx = Awaited<ReturnType<typeof requireProjectContext>>;

/**
 * Главы из формы: активные участники этого проекта; не-продюсер не может назначить себя
 * (если уже был главой — остаться может). Возвращает текст ошибки или null.
 */
async function checkHeads(
  ctx: Ctx,
  projectId: string,
  headIds: string[],
  previousHeadIds: string[],
): Promise<string | null> {
  const selfId = ctx.membership.id;
  if (
    !isProducerRole(ctx.role) &&
    headIds.includes(selfId) &&
    !previousHeadIds.includes(selfId)
  ) {
    return SELF_HEAD_ERROR;
  }
  try {
    await assertInProject("ProjectMembership", headIds, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return MEMBER_NOT_FOUND;
    throw error;
  }
  return null;
}

async function headLabels(projectId: string, ids: string[]) {
  const labels = await memberLabelsById(projectId, ids);
  return ids.map((id) => ({ membershipId: id, name: labels.get(id) ?? id }));
}

export async function createDepartmentAction(
  projectId: string,
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!canManageDepartments(ctx)) return { error: NO_RIGHTS };

  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error), values: formValues(formData) };
  const { name, codePrefix, headMembershipIds } = parsed.data;

  const headError = await checkHeads(ctx, projectId, headMembershipIds, []);
  if (headError) return { error: headError, values: formValues(formData) };

  let created: { id: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const last = await tx.department.aggregate({
        where: { projectId },
        _max: { sortOrder: true },
      });
      const department = await tx.department.create({
        data: {
          projectId,
          name,
          codePrefix,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
        select: { id: true },
      });
      if (headMembershipIds.length > 0) {
        await tx.departmentHead.createMany({
          data: headMembershipIds.map((membershipId) => ({
            departmentId: department.id,
            membershipId,
          })),
        });
      }
      return department;
    });
  } catch (error) {
    if (isUniqueError(error)) return { error: DUPLICATE_ERROR, values: formValues(formData) };
    throw error;
  }

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.department,
    entityId: created.id,
    action: "CREATE",
    summary: `Создан цех «${name}» (префикс ${codePrefix})`,
    changes: {
      name,
      codePrefix,
      heads: await headLabels(projectId, headMembershipIds),
    },
  });

  revalidateDepartments(projectId);
  return { success: "Цех создан" };
}

export async function updateDepartmentAction(
  projectId: string,
  departmentId: string,
  _prev: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const ctx = await requireProjectContext(projectId);
  if (!canManageDepartments(ctx)) return { error: NO_RIGHTS };

  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }

  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error), values: formValues(formData) };
  const { name, codePrefix, headMembershipIds } = parsed.data;

  const before = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { name: true, codePrefix: true, heads: { select: { membershipId: true } } },
  });
  if (!before) return { error: NOT_FOUND };
  const beforeHeadIds = before.heads.map((h) => h.membershipId);

  const headError = await checkHeads(ctx, projectId, headMembershipIds, beforeHeadIds);
  if (headError) return { error: headError, values: formValues(formData) };

  const added = headMembershipIds.filter((id) => !beforeHeadIds.includes(id));
  const removed = beforeHeadIds.filter((id) => !headMembershipIds.includes(id));

  try {
    await prisma.$transaction(async (tx) => {
      // Смена префикса не трогает существующие коды статей — новый префикс только для новых строк.
      await tx.department.update({
        where: { id: departmentId, projectId },
        data: { name, codePrefix },
      });
      if (removed.length > 0) {
        await tx.departmentHead.deleteMany({
          where: { departmentId, membershipId: { in: removed } },
        });
      }
      if (added.length > 0) {
        await tx.departmentHead.createMany({
          data: added.map((membershipId) => ({ departmentId, membershipId })),
          skipDuplicates: true,
        });
      }
    });
  } catch (error) {
    if (isUniqueError(error)) return { error: DUPLICATE_ERROR, values: formValues(formData) };
    throw error;
  }

  const changes: Record<string, unknown> = {};
  if (before.name !== name) changes.name = { from: before.name, to: name };
  if (before.codePrefix !== codePrefix) {
    changes.codePrefix = { from: before.codePrefix, to: codePrefix };
  }
  if (added.length > 0) changes.headsAdded = await headLabels(projectId, added);
  if (removed.length > 0) changes.headsRemoved = await headLabels(projectId, removed);

  if (Object.keys(changes).length > 0) {
    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.department,
      entityId: departmentId,
      action: "UPDATE",
      summary:
        before.name === name
          ? `Изменён цех «${name}»`
          : `Изменён цех «${before.name}» → «${name}»`,
      changes,
    });
  }

  revalidateDepartments(projectId);
  return { success: "Цех сохранён" };
}

export async function reorderDepartmentsAction(
  projectId: string,
  orderedIds: unknown,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!canManageDepartments(ctx)) return { error: NO_RIGHTS };

  const parsed = reorderDepartmentsSchema.safeParse(orderedIds);
  if (!parsed.success) return { error: "Некорректный порядок" };
  const ids = [...new Set(parsed.data)];

  try {
    await assertInProject("Department", ids, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }

  const before = await prisma.department.findMany({
    where: { projectId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.department.update({
        where: { id, projectId },
        data: { sortOrder: index },
      }),
    ),
  );

  const names = new Map(before.map((d) => [d.id, d.name]));
  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.department,
    entityId: projectId,
    action: "UPDATE",
    summary: "Изменён порядок цехов",
    changes: {
      from: before.map((d) => d.name),
      to: ids.map((id) => names.get(id) ?? id),
    },
  });

  revalidateDepartments(projectId);
  return {};
}

export async function deleteDepartmentAction(
  projectId: string,
  departmentId: string,
): Promise<{ error?: string }> {
  const ctx = await requireProjectContext(projectId);
  if (!canManageDepartments(ctx)) return { error: NO_RIGHTS };

  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { error: NOT_FOUND };
    throw error;
  }

  // Со шага 2: цех со сметой или утверждёнными версиями удалить нельзя.
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: {
      name: true,
      codePrefix: true,
      heads: { select: { membershipId: true } },
    },
  });
  if (!department) return { error: NOT_FOUND };

  const headIds = department.heads.map((h) => h.membershipId);
  const heads = await headLabels(projectId, headIds);

  await prisma.department.delete({ where: { id: departmentId, projectId } });

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.department,
    entityId: departmentId,
    action: "DELETE",
    summary: `Удалён цех «${department.name}»`,
    changes: { name: department.name, codePrefix: department.codePrefix, heads },
  });

  revalidateDepartments(projectId);
  return {};
}
