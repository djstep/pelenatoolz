import { requireProjectContext } from "@/features/projects/lib/project-context";
import { listProjectRoles } from "@/features/memberships/queries";
import { listResourceCategories } from "@/features/resources/queries";
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

  const [roles, categories] = await Promise.all([
    listProjectRoles(projectId),
    listResourceCategories(projectId),
  ]);
  const canManage = canManageMembers(ctx.matrix);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Роли и права доступа</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Матрица по разделам и отдельно — финансовые условия по типам ресурсов
          (актёры, локации, каждая категория).
        </p>
      </div>
      <Card>
        <RolesManager
          projectId={projectId}
          roles={roles}
          canManage={canManage}
          resourceCategories={categories.map((c) => ({
            id: c.id,
            name: c.name,
          }))}
        />
      </Card>
    </div>
  );
}
