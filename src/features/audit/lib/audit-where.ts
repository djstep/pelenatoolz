import type { AuditAction, Prisma } from "@prisma/client";
import { auditDateBounds } from "@/features/audit/lib/audit-time";

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
  /** Пояс проекта: дни фильтра «с … по …» считаются по нему. */
  timeZone = "Europe/Moscow",
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
  const bounds = auditDateBounds(filters.dateFrom, filters.dateTo, timeZone);
  if (bounds.gte || bounds.lt) where.createdAt = bounds;
  if (filters.search?.trim()) {
    where.summary = { contains: filters.search.trim(), mode: "insensitive" };
  }
  return where;
}
