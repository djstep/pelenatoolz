import type { AuditAction, Prisma } from "@prisma/client";

export type AuditLogFilters = {
  entityType?: string;
  action?: AuditAction;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

/** Только записи видимых типов (`visibleAuditEntityTypes`); `null` — без ограничения. */
export function visibleTypesWhere(
  projectId: string,
  visibleTypes: readonly string[] | null,
): Prisma.AuditLogWhereInput {
  return visibleTypes ? { projectId, entityType: { in: [...visibleTypes] } } : { projectId };
}

/**
 * Условие выборки журнала. Ограничение по видимым типам действует всегда, в том числе при
 * фильтре «Сущность». Поиск — только по тексту записи (`summary`): `changes` в поиске не
 * участвуют, поэтому скрытые фин. поля по значению не найти.
 */
export function buildAuditLogWhere(
  projectId: string,
  filters: AuditLogFilters,
  visibleTypes: readonly string[] | null,
): Prisma.AuditLogWhereInput {
  const where = visibleTypesWhere(projectId, visibleTypes);

  if (filters.entityType) {
    where.entityType =
      visibleTypes && !visibleTypes.includes(filters.entityType)
        ? { in: [] }
        : filters.entityType;
  }
  if (filters.action) {
    where.action = filters.action;
  }
  if (filters.userId) {
    where.userId = filters.userId;
  }
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) {
      where.createdAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }
  if (filters.search?.trim()) {
    where.summary = { contains: filters.search.trim(), mode: "insensitive" };
  }
  return where;
}
