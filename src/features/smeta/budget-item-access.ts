import "server-only";

import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import {
  canReadAllSmeta,
  canReadDepartmentSmeta,
  type SmetaAccessContext,
} from "@/features/smeta/lib/smeta-access";
import { budgetItemPath, type BudgetItemOption } from "@/features/smeta/lib/budget-item-option";
import { ACTIVE_BUDGET_ITEM, isItemArchived } from "@/features/smeta/lib/item-where";
import { prisma } from "@/shared/db/prisma";

/** Статья и подстатья строки — для подписи без кода. */
const PATH_SELECT = { select: { name: true, article: { select: { templateArticle: { select: { name: true } } } } } } as const;

/** Цеха, чьи сметы пользователь видит: "all" или список id. */
export function visibleDepartments(access: SmetaAccessContext): "all" | readonly string[] {
  return canReadAllSmeta(access) ? "all" : access.headDepartmentIds;
}

/**
 * Статьи смет для выбора в начислениях, платежах и карточках: только действующие и только
 * из смет, которые пользователь видит (глава — свой цех, продюсер и «просмотр всех» — все).
 */
export async function listVisibleBudgetItems(
  projectId: string,
  access: SmetaAccessContext,
): Promise<BudgetItemOption[]> {
  const all = canReadAllSmeta(access);
  if (!all && access.headDepartmentIds.length === 0) return [];
  const rows = await prisma.budgetItem.findMany({
    where: {
      projectId,
      ...ACTIVE_BUDGET_ITEM,
      ...(all ? {} : { departmentId: { in: [...access.headDepartmentIds] } }),
    },
    select: {
      id: true,
      name: true,
      department: { select: { name: true } },
      subarticle: PATH_SELECT,
    },
    orderBy: [{ department: { sortOrder: "asc" } }, { sortOrder: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: budgetItemPath(r),
    departmentName: r.department.name,
    archived: false,
  }));
}

/**
 * Подписи статей, которые уже стоят на записях (в т.ч. архивных и из смет, которые
 * пользователь не видит). Для невидимых — без кода и названия.
 */
export async function describeBudgetItems(
  projectId: string,
  access: SmetaAccessContext,
  ids: readonly (string | null | undefined)[],
): Promise<Record<string, BudgetItemOption>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return {};
  const rows = await prisma.budgetItem.findMany({
    where: { projectId, id: { in: unique } },
    select: {
      id: true,
      name: true,
      departmentId: true,
      archivedAt: true,
      department: { select: { name: true } },
      subarticle: PATH_SELECT,
    },
  });
  const out: Record<string, BudgetItemOption> = {};
  for (const r of rows) {
    out[r.id] = canReadDepartmentSmeta(access, r.departmentId)
      ? {
          id: r.id,
          name: r.name,
          path: budgetItemPath(r),
          departmentName: r.department.name,
          archived: r.archivedAt !== null,
        }
      : { id: r.id, name: "", path: "", departmentName: "", archived: false, hidden: true };
  }
  return out;
}

/**
 * Статьи, пришедшие из браузера: из этого проекта, действующие и из смет, которые пользователь
 * видит. Статью, которая уже стоит на записи (`keep`), можно оставить как есть без этих прав.
 * Возвращает текст ошибки или null.
 */
export async function checkBudgetItemsUsable(
  projectId: string,
  access: SmetaAccessContext,
  ids: readonly (string | null | undefined)[],
  keep: readonly (string | null | undefined)[] = [],
): Promise<string | null> {
  const kept = new Set(keep.filter((id): id is string => !!id));
  const fresh = [...new Set(ids.filter((id): id is string => !!id && !kept.has(id)))];
  if (fresh.length === 0) return null;

  try {
    await assertInProject("BudgetItem", fresh, projectId);
  } catch (error) {
    if (isNotInProjectError(error)) return "Статья сметы не найдена";
    throw error;
  }
  const rows = await prisma.budgetItem.findMany({
    where: { projectId, id: { in: fresh } },
    select: {
      departmentId: true,
      archivedAt: true,
      subarticle: { select: { archivedAt: true, article: { select: { archivedAt: true } } } },
    },
  });
  // Тот же текст, что и для чужой статьи: по ответу не понять, что статья есть.
  if (rows.some((r) => !canReadDepartmentSmeta(access, r.departmentId))) {
    return "Статья сметы не найдена";
  }
  if (rows.some(isItemArchived)) {
    return "Статья в архиве сметы — выберите действующую";
  }
  return null;
}
