import { CharactersWorkspace } from "@/features/characters/components/characters-workspace";
import { listCharactersWithCasting } from "@/features/characters/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CharactersPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const characters = await listCharactersWithCasting(projectId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Персонажи</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Роли по сценарию и утверждённый каст. Подбор кандидатов — в разделе Кастинг.
        </p>
      </div>
      <Card>
        <CharactersWorkspace
          projectId={projectId}
          locale={locale}
          projectType={ctx.project.type}
          characters={characters}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
