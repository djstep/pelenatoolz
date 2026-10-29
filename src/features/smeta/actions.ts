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
import {
  approveBudget,
  returnBudget,
  submitBudget,
} from "@/features/smeta/approval-queries";
import type { SmetaCheck } from "@/features/smeta/lib/main-sheet";
import type { BudgetStatus } from "@prisma/client";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import {
  canApproveSmeta,
  canEditDepartmentSmeta,
} from "@/features/smeta/lib/smeta-access";
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
  revalidatePath(`/ru/projects/${projectId}/smeta/${departmentId}`, "layout");
}

async function departmentName(projectId: string, departmentId: string) {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, projectId },
    select: { name: true },
  });
  return department?.name ?? "";
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
      status: BudgetStatus;
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
    return {
      error:
        saved.error === "not_found"
          ? NOT_FOUND
          : saved.error === "not_draft"
            ? "Утверждённая версия только для чтения — сохранить нельзя"
            : "Некорректные листы книги",
    };
  }

  if (saved.changes || saved.statusChange) {
    const name = await departmentName(projectId, departmentId);
    if (saved.changes) {
      await recordAudit(ctx, {
        projectId,
        entityType: AuditEntityType.budget,
        entityId: saved.budgetId,
        action: "UPDATE",
        summary: changesSummary(name, saved.changes),
        changes: { ...saved.changes, changed: saved.changes.changed.slice(0, 50) },
      });
    }
    if (saved.statusChange) {
      await recordAudit(ctx, {
        projectId,
        entityType: AuditEntityType.budget,
        entityId: saved.budgetId,
        action: "UPDATE",
        summary:
          saved.statusChange === "changed_after_submit"
            ? `Смета цеха «${name}» изменена после отправки на утверждение — статус «черновик»`
            : `Смета цеха «${name}» изменена после утверждения — статус «черновик»`,
        changes: { status: saved.status, revision: saved.revision },
      });
      revalidateSmeta(projectId, departmentId);
    }
  }

  return {
    success: "Сохранено",
    updatedAt: saved.updatedAt,
    revision: saved.revision,
    checks: saved.checks,
    usedCodes: await listDepartmentCodes(projectId, departmentId),
    status: saved.status,
  };
}

const COMMENT_MAX = 2000;

/** Отправить смету на утверждение (глава цеха). Комментарий необязателен. */
export async function submitBudgetAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
): Promise<{ error?: string; success?: string }> {
  const access = await requireDepartmentEditor(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const { ctx } = access;

  const parsed = z
    .object({
      revision: z.number().int().min(0),
      comment: z.string().max(COMMENT_MAX).optional(),
    })
    .safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные" };
  const comment = parsed.data.comment?.trim() || null;

  const result = await submitBudget({
    projectId,
    departmentId,
    userId: ctx.user.id!,
    revision: parsed.data.revision,
    comment,
  });
  if (!result.ok) return { error: result.error };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.budget,
    entityId: result.budgetId,
    action: "UPDATE",
    summary: `Смета цеха «${await departmentName(projectId, departmentId)}» отправлена на утверждение`,
    changes: {
      revision: parsed.data.revision,
      comment,
      itemCount: result.itemCount,
      total: result.total,
    },
  });
  revalidateSmeta(projectId, departmentId);
  return { success: "Смета отправлена на утверждение" };
}

/** Вход, цех из этого проекта и право утверждать (только продюсер). */
async function requireApprover(projectId: string, departmentId: unknown) {
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
  if (!canApproveSmeta(ctx)) return { ok: false, error: NO_RIGHTS } as const;
  return { ok: true, ctx } as const;
}

/**
 * Утвердить смету (продюсер): неизменяемая версия из той ревизии, которую он видел.
 * Продюсер, который сам глава цеха, тоже может — в версии и аудите это отмечается.
 */
export async function approveBudgetAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
): Promise<{ error?: string; success?: string; number?: number }> {
  const access = await requireApprover(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const { ctx } = access;

  const parsed = z.object({ revision: z.number().int().min(0) }).safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные" };

  const approvedByHead = canEditDepartmentSmeta(ctx, departmentId);
  const result = await approveBudget({
    projectId,
    departmentId,
    userId: ctx.user.id!,
    revision: parsed.data.revision,
    approvedByHead,
  });
  if (!result.ok) return { error: result.error };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.budgetVersion,
    entityId: result.versionId,
    action: "CREATE",
    summary: `Смета цеха «${await departmentName(projectId, departmentId)}»: утверждена версия ${result.number}${approvedByHead ? " (утвердил глава цеха)" : ""}`,
    changes: {
      number: result.number,
      revision: parsed.data.revision,
      total: result.total,
      itemCount: result.itemCount,
      approvedByHead,
    },
  });
  revalidateSmeta(projectId, departmentId);
  return { success: `Утверждена версия ${result.number}`, number: result.number };
}

/** Вернуть смету главе (продюсер). Комментарий обязателен — глава его видит. */
export async function returnBudgetAction(
  projectId: string,
  departmentId: string,
  payload: unknown,
): Promise<{ error?: string; success?: string }> {
  const access = await requireApprover(projectId, departmentId);
  if (!access.ok) return { error: access.error };
  const { ctx } = access;

  const parsed = z.object({ comment: z.string().max(COMMENT_MAX) }).safeParse(payload);
  if (!parsed.success) return { error: "Некорректные данные" };
  const comment = parsed.data.comment.trim();
  if (!comment) return { error: "Напишите, что исправить" };

  const result = await returnBudget({ projectId, departmentId, userId: ctx.user.id!, comment });
  if (!result.ok) return { error: result.error };

  await recordAudit(ctx, {
    projectId,
    entityType: AuditEntityType.budget,
    entityId: result.budgetId,
    action: "UPDATE",
    summary: `Смета цеха «${await departmentName(projectId, departmentId)}» возвращена главе`,
    changes: { comment },
  });
  revalidateSmeta(projectId, departmentId);
  return { success: "Смета возвращена главе" };
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
