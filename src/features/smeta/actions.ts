"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createDepartmentBudget,
  listDepartmentCodes,
  persistDepartmentBudget,
  setBudgetSheetPinned,
  type ItemChanges,
} from "@/features/smeta/queries";
import type { SmetaCheck } from "@/features/smeta/lib/main-sheet";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { canEditDepartmentSmeta } from "@/features/smeta/lib/smeta-access";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { prisma } from "@/shared/db/prisma";
import { AuditEntityType } from "@/shared/audit/entity-types";
import { recordAudit } from "@/shared/audit/with-audit";

const NO_RIGHTS = "Недостаточно прав";
const NOT_FOUND = "Смета не найдена";

function revalidateSmeta(projectId: string, departmentId: string) {
  revalidatePath(`/ru/projects/${projectId}/smeta`);
  revalidatePath(`/ru/projects/${projectId}/smeta/${departmentId}`);
}

/** Вход, цех из этого проекта и право править его смету (только глава цеха). */
async function requireDepartmentEditor(projectId: string, departmentId: unknown) {
  const ctx = await requireProjectContext(projectId);
  if (typeof departmentId !== "string" || !departmentId) {
    return { ok: false, error: NOT_FOUND } as const;
  }
  try {
    await assertInProject("Department", departmentId, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return { ok: false, error: NOT_FOUND } as const;
    throw error;
  }
  if (!canEditDepartmentSmeta(ctx, departmentId)) return { ok: false, error: NO_RIGHTS } as const;
  return { ok: true, ctx } as const;
}

export async function createDepartmentBudgetAction(
  projectId: string,
  departmentId: string,
): Promise<{ error?: string; success?: string }> {
  const access = await requireDepartmentEditor(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const { ctx } = access;

  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { name: true },
  });
  if (!department) return { error: NOT_FOUND };

  const result = await createDepartmentBudget(
    projectId,
    departmentId,
    `Смета — ${department.name}`,
    ctx.user.id!,
  );
  if (result.created) {
    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.budget,
      entityId: result.id,
      action: "CREATE",
      summary: `Создана смета цеха «${department.name}»`,
      changes: { departmentId },
    });
  }
  revalidateSmeta(projectId, departmentId);
  return { success: "Смета создана" };
}

function changesSummary(departmentName: string, c: ItemChanges) {
  const parts = [
    c.added.length ? `добавлено ${c.added.length}` : "",
    c.changed.length ? `изменено ${c.changed.length}` : "",
    c.archived.length ? `в архив ${c.archived.length}` : "",
    c.restored.length ? `восстановлено ${c.restored.length}` : "",
  ].filter(Boolean);
  return `Смета цеха «${departmentName}»: статьи — ${parts.join(", ")}`;
}

export type SaveBudgetResult =
  | { error: string }
  | {
      error?: undefined;
      success: string;
      updatedAt: string;
      revision: number;
      checks: SmetaCheck[];
      usedCodes: string[];
    };

/** Автосохранение книги цеха. Разбор основного листа в статьи — здесь, на сервере. */
export async function saveDepartmentBudgetAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
): Promise<SaveBudgetResult> {
  const access = await requireDepartmentEditor(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const { ctx } = access;

  const parsed = z
    .object({ data: z.record(z.string(), z.unknown()) })
    .safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные книги" };

  const saved = await persistDepartmentBudget(projectId, departmentId, parsed.data.data);
  if (saved.error !== undefined) {
    return { error: saved.error === "not_found" ? NOT_FOUND : "Некорректные листы книги" };
  }

  if (saved.changes) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, projectId },
      select: { name: true },
    });
    await recordAudit(ctx, {
      projectId,
      entityType: AuditEntityType.budget,
      entityId: saved.budgetId,
      action: "UPDATE",
      summary: changesSummary(department?.name ?? "", saved.changes),
      changes: { ...saved.changes, changed: saved.changes.changed.slice(0, 50) },
    });
  }

  return {
    success: "Сохранено",
    updatedAt: saved.updatedAt,
    revision: saved.revision,
    checks: saved.checks,
    usedCodes: await listDepartmentCodes(projectId, departmentId),
  };
}

export async function toggleBudgetSheetPinnedAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
) {
  const access = await requireDepartmentEditor(projectId, departmentId);
  if (!access.ok) return { error: access.error };

  const parsed = z
    .object({ sheetId: z.string().min(1).max(64), pinned: z.boolean() })
    .safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные" };

  const saved = await setBudgetSheetPinned(
    projectId,
    departmentId,
    parsed.data.sheetId,
    parsed.data.pinned,
  );
  if (!saved) return { error: "Лист не найден" };

  revalidateSmeta(projectId, departmentId);
  return { success: true as const, sheetId: saved.sheetKey, pinned: saved.pinned };
}
