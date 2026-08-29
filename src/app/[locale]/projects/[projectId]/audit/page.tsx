import { prisma } from "@/shared/db/prisma";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function AuditLogPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("members:read") && !ctx.can("project:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const logs = await prisma.auditLog.findMany({
    where: { projectId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Журнал изменений</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Кто, что и когда менял в проекте (последние 100 записей).
        </p>
      </div>
      <Card>
        {logs.length === 0 ? (
          <p className="text-sm text-[var(--muted-fg)]">Записей пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                  <th className="py-2 pr-3">Когда</th>
                  <th className="py-2 pr-3">Кто</th>
                  <th className="py-2 pr-3">Действие</th>
                  <th className="py-2 pr-3">Сущность</th>
                  <th className="py-2 pr-3">Описание</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-[var(--border)]/50 align-top"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">
                      {new Date(log.createdAt).toLocaleString("ru-RU")}
                    </td>
                    <td className="py-2 pr-3">
                      <div>{log.user.name}</div>
                      <div className="text-xs text-[var(--muted-fg)]">
                        {log.user.email}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{log.action}</td>
                    <td className="py-2 pr-3">
                      <div>{log.entityType}</div>
                      <div className="font-mono text-[10px] text-[var(--muted-fg)]">
                        {log.entityId}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{log.summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
