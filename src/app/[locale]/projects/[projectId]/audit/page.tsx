import { requireProjectContext } from "@/features/projects/lib/project-context";
import { AuditWorkspace } from "@/features/audit/components/audit-workspace";
import {
  listAuditEntityTypes,
  listAuditLogs,
} from "@/features/audit/queries";
import type { AuditAction } from "@prisma/client";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{
    entityType?: string;
    action?: string;
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    page?: string;
  }>;
};

export default async function AuditLogPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const sp = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("members:read") && !ctx.can("project:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const page = sp.page ? Number(sp.page) : 1;
  const action =
    sp.action && ["CREATE", "UPDATE", "DELETE"].includes(sp.action)
      ? (sp.action as AuditAction)
      : undefined;

  const [data, entityTypes] = await Promise.all([
    listAuditLogs(projectId, {
      entityType: sp.entityType,
      action,
      userId: sp.userId,
      dateFrom: sp.dateFrom,
      dateTo: sp.dateTo,
      search: sp.search,
      page: Number.isFinite(page) ? page : 1,
    }),
    listAuditEntityTypes(projectId),
  ]);

  return (
    <AuditWorkspace
      locale={locale}
      projectId={projectId}
      rows={data.rows}
      total={data.total}
      page={data.page}
      totalPages={data.totalPages}
      entityTypes={entityTypes}
      users={data.users}
      filters={{
        entityType: sp.entityType ?? "",
        action: sp.action ?? "",
        userId: sp.userId ?? "",
        dateFrom: sp.dateFrom ?? "",
        dateTo: sp.dateTo ?? "",
        search: sp.search ?? "",
      }}
    />
  );
}
