import { DepartmentsWorkspace } from "@/features/departments/components/departments-workspace";
import { listDepartments, listHeadCandidates } from "@/features/departments/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { isProducerRole } from "@/features/roles/role-rules";
import { canManageDepartments } from "@/features/smeta/lib/smeta-access";
import { Card } from "@/shared/ui/card";

// Vercel (Fluid compute, потолок 300 с): выгрузка на диск (до 50 с) и пересчёт доступов к папкам после ответа
// (`after()`, до 40 с) идут в одной функции — до 120 с. OAuth дисков — здесь же.
export const maxDuration = 120;

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function SettingsDepartmentsPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canManageDepartments(ctx)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [departments, candidates] = await Promise.all([
    listDepartments(projectId),
    listHeadCandidates(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">Цеха</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          У каждого цеха своя смета. Главы цеха ведут её и отправляют продюсеру на утверждение.
        </p>
      </div>
      <Card>
        <DepartmentsWorkspace
          projectId={projectId}
          departments={departments}
          candidates={candidates}
          selfMembershipId={ctx.membership.id}
          canAssignSelf={isProducerRole(ctx.role)}
        />
      </Card>
    </div>
  );
}
