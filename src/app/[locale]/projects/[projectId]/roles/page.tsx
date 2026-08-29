import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listProjectRoles } from "@/features/memberships/queries";
import { RolesManager } from "@/features/roles/components/roles-manager";
import { canManageMembers } from "@/features/memberships/permissions";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectRolesPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("members:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const roles = await listProjectRoles(projectId);
  const canManage = canManageMembers(ctx.matrix);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Роли и права доступа</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Настройка матрицы прав по каждому разделу проекта.
        </p>
      </div>
      <Card>
        <RolesManager
          projectId={projectId}
          roles={roles}
          canManage={canManage}
        />
      </Card>
    </div>
  );
}
