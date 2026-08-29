import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ActorsWorkspace } from "@/features/actors/components/actors-workspace";
import { listActors } from "@/features/actors/queries";
import { listCharacters } from "@/features/script/queries";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ActorsPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [actors, characters] = await Promise.all([
    listActors(projectId),
    listCharacters(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Актёры</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Каст проекта, условия контрагента и гонорары.
        </p>
      </div>
      <Card>
        <ActorsWorkspace
          projectId={projectId}
          actors={actors}
          characters={characters}
          canWrite={ctx.can("cast:write")}
        />
      </Card>
    </div>
  );
}
