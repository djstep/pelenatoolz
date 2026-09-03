import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/prisma";

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

export type AuditLogRow = {
  id: string;
  createdAt: Date;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string | null;
  changes: Prisma.JsonValue;
  user: { id: string; name: string; email: string };
};

export async function listAuditLogs(
  projectId: string,
  filters: AuditLogFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(10, filters.pageSize ?? 25));

  const where: Prisma.AuditLogWhereInput = { projectId };

  if (filters.entityType) {
    where.entityType = filters.entityType;
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

  const [rows, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where: { projectId },
      distinct: ["userId"],
      select: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    rows: rows as AuditLogRow[],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    users: users.map((r) => r.user),
  };
}

export async function listAuditEntityTypes(projectId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { projectId },
    distinct: ["entityType"],
    select: { entityType: true },
    orderBy: { entityType: "asc" },
  });
  return rows.map((r) => r.entityType);
}
