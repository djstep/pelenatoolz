import "server-only";

import { listDepartmentsForSmeta } from "@/features/departments/queries";
import {
  assertInProject,
  isNotInProjectError,
} from "@/features/memberships/assert-in-project";
import { loadFacts } from "@/features/smeta/facts";
import { buildPlanFact, type PlanFactReport } from "@/features/smeta/lib/plan-fact";
import {
  canReadAllSmeta,
  canReadDepartmentSmeta,
  type SmetaAccessContext,
} from "@/features/smeta/lib/smeta-access";
import { prisma } from "@/shared/db/prisma";

export type PlanFactFilters = {
  /** Пусто — все цеха, которые пользователь видит. */
  departmentId: string | null;
  /** ГГГГ-ММ-ДД, включительно. */
  dateFrom: string | null;
  dateTo: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  return Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()) ? null : value;
}

/**
 * Фильтры из браузера (адрес страницы или выгрузка). Цех — только из этого проекта и только
 * тот, чью смету пользователь видит; иначе null (как будто цеха нет).
 */
export async function resolvePlanFactFilters(
  projectId: string,
  access: SmetaAccessContext,
  raw: { departmentId?: unknown; dateFrom?: unknown; dateTo?: unknown },
): Promise<PlanFactFilters | null> {
  let departmentId: string | null = null;
  if (typeof raw.departmentId === "string" && raw.departmentId) {
    try {
      await assertInProject("Department", raw.departmentId, projectId);
    } catch (error) {
      if (isNotInProjectError(error)) return null;
      throw error;
    }
    if (!canReadDepartmentSmeta(access, raw.departmentId)) return null;
    departmentId = raw.departmentId;
  }
  let dateFrom = cleanDate(raw.dateFrom);
  let dateTo = cleanDate(raw.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  return { departmentId, dateFrom, dateTo };
}

/** Цеха, которые пользователь видит в плане/факте (с учётом фильтра). */
export async function listPlanFactDepartments(projectId: string, access: SmetaAccessContext) {
  return listDepartmentsForSmeta(
    projectId,
    canReadAllSmeta(access) ? null : access.headDepartmentIds,
  );
}

/**
 * План/факт: план — последняя утверждённая версия цеха (целиком), факт — начисления и
 * платежи за период, всё с налогом. Фильтры должны прийти из `resolvePlanFactFilters`.
 */
export async function getPlanFact(
  projectId: string,
  access: SmetaAccessContext,
  filters: PlanFactFilters,
  /** Уже прочитанный `listPlanFactDepartments` — чтобы не ходить в базу второй раз. */
  visibleDepartments?: Awaited<ReturnType<typeof listPlanFactDepartments>>,
): Promise<PlanFactReport> {
  const visible = visibleDepartments ?? (await listPlanFactDepartments(projectId, access));
  const departments = filters.departmentId
    ? visible.filter((d) => d.id === filters.departmentId)
    : visible;
  const departmentIds = departments.map((d) => d.id);
  const withUnassigned = canReadAllSmeta(access) && !filters.departmentId;

  const dateRange =
    filters.dateFrom || filters.dateTo
      ? {
          ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
          ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
        }
      : undefined;

  const [versions, facts] = await Promise.all([
    departmentIds.length === 0
      ? Promise.resolve([])
      : prisma.budgetVersion.findMany({
          where: { projectId, departmentId: { in: departmentIds } },
          orderBy: [{ departmentId: "asc" }, { number: "desc" }],
          distinct: ["departmentId"],
          select: {
            departmentId: true,
            number: true,
            approvedAt: true,
            lines: {
              orderBy: { sortOrder: "asc" },
              select: { budgetItemId: true, code: true, name: true, total: true },
            },
          },
        }),
    loadFacts(prisma, projectId, { departments: departmentIds, dateRange, withUnassigned }),
  ]);

  const plannedIds = new Set(versions.flatMap((v) => v.lines.map((l) => l.budgetItemId)));
  const factOnlyIds = [...facts.byItem.keys()].filter((id) => !plannedIds.has(id));
  const [items, earlier] = await Promise.all([
    plannedIds.size + factOnlyIds.length === 0
      ? Promise.resolve([])
      : prisma.budgetItem.findMany({
          where: { projectId, id: { in: [...plannedIds, ...factOnlyIds] } },
          select: { id: true, code: true, name: true, departmentId: true, archivedAt: true },
        }),
    // Была ли статья с фактом хоть в одной версии — тогда она «вне плана», а не «без плана».
    factOnlyIds.length === 0
      ? Promise.resolve([])
      : prisma.budgetVersionLine.findMany({
          where: { budgetItemId: { in: factOnlyIds } },
          distinct: ["budgetItemId"],
          select: { budgetItemId: true },
        }),
  ]);
  const inVersion = new Set([...plannedIds, ...earlier.map((e) => e.budgetItemId)]);

  return buildPlanFact({
    departments,
    versions: new Map(
      versions.map((v) => [
        v.departmentId,
        {
          number: v.number,
          approvedAt: v.approvedAt.toISOString(),
          lines: v.lines.map((l) => ({
            itemId: l.budgetItemId,
            code: l.code,
            name: l.name,
            total: Number(l.total),
          })),
        },
      ]),
    ),
    items: new Map(
      items.map((i) => [
        i.id,
        {
          code: i.code,
          name: i.name,
          departmentId: i.departmentId,
          archived: i.archivedAt !== null,
          inAnyVersion: inVersion.has(i.id),
        },
      ]),
    ),
    facts: facts.byItem,
    unassigned: withUnassigned ? facts.unassigned : null,
  });
}
