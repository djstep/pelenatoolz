import { CrewWorkspace } from "@/features/crew/components/crew-workspace";
import { crewRights } from "@/features/crew/lib/crew-rules";
import { listCrew, listCrewDepartments } from "@/features/crew/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CrewPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("crew:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к команде</p>;
  }

  const rights = crewRights(ctx.can);
  const [rows, departments] = await Promise.all([
    listCrew(projectId, rights),
    listCrewDepartments(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">Команда</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Люди проекта по цехам. Участники с доступом в систему — в разделе «Участники».
        </p>
      </div>
      <CrewWorkspace
        projectId={projectId}
        locale={locale}
        rows={rows}
        departments={departments}
        rights={rights}
      />
    </div>
  );
}
