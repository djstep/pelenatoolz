import type { AuditAction, Prisma } from "@prisma/client";
import {
  buildAuditLogWhere,
  visibleTypesWhere,
  type AuditLogFilters,
} from "@/features/audit/lib/audit-where";
import {
  AUDIT_TYPES_WITH_CATEGORY,
  stripHiddenFinanceFields,
  visibleAuditEntityTypes,
  type AuditViewer,
} from "@/features/audit/lib/entity-access";
import { auditMemberName } from "@/shared/audit/member-name";
import { prisma } from "@/shared/db/prisma";

export type AuditLogRow = {
  id: string;
  createdAt: Date;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string | null;
  changes: Prisma.JsonValue;
  /** Автор — только имя («Без имени»), почта в браузер не уходит. */
  user: { id: string; name: string };
};

/**
 * Журнал проекта для пользователя: только записи видимых ему разделов, фин. поля — по его
 * фин. правам, автор — по имени. Всё отбирается здесь, на сервере.
 */
export async function listAuditLogs(
  projectId: string,
  viewer: AuditViewer,
  filters: AuditLogFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(10, filters.pageSize ?? 25));
  const visibleTypes = visibleAuditEntityTypes(viewer);
  const where = buildAuditLogWhere(projectId, filters, visibleTypes);

  const [rows, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: visibleTypesWhere(projectId, visibleTypes),
      distinct: ["userId"],
      select: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const categoryIds = await resourceCategoryIds(
    projectId,
    rows.filter((r) => AUDIT_TYPES_WITH_CATEGORY.includes(r.entityType)).map((r) => r.entityId),
  );

  return {
    rows: rows.map(
      (r): AuditLogRow => ({
        id: r.id,
        createdAt: r.createdAt,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        summary: r.summary,
        changes: stripHiddenFinanceFields(r.entityType, r.changes, viewer, {
          categoryId: categoryIds.get(r.entityId) ?? null,
        }) as Prisma.JsonValue,
        user: { id: r.user.id, name: auditMemberName(r.user.name) },
      }),
    ),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    users: users.map((r) => ({ id: r.user.id, name: auditMemberName(r.user.name) })),
  };
}

/** Категории ресурсов по id — для фин. прав по категории. Удалённых ресурсов нет в ответе. */
async function resourceCategoryIds(projectId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, string>();
  const items = await prisma.resourceItem.findMany({
    where: { id: { in: itemIds }, category: { projectId } },
    select: { id: true, categoryId: true },
  });
  return new Map(items.map((i) => [i.id, i.categoryId]));
}

export async function listAuditEntityTypes(projectId: string, viewer: AuditViewer) {
  const rows = await prisma.auditLog.findMany({
    where: visibleTypesWhere(projectId, visibleAuditEntityTypes(viewer)),
    distinct: ["entityType"],
    select: { entityType: true },
    orderBy: { entityType: "asc" },
  });
  return rows.map((r) => r.entityType);
}
