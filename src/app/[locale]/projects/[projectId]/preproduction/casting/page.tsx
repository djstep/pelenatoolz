import { CastingWorkspace } from "@/features/casting/components/casting-workspace";
import {
  listCastingPeople,
  listCharactersForCasting,
} from "@/features/casting/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function CastingPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [people, characters] = await Promise.all([
    listCastingPeople(projectId),
    listCharactersForCasting(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Кастинг</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Воронка кандидатов на роли: реальные люди и заявки на персонажей.
        </p>
      </div>
      <Card>
        <CastingWorkspace
          projectId={projectId}
          locale={locale}
          people={people}
          characters={characters}
          canWrite={ctx.can("cast:write")}
        />
      </Card>
    </div>
  );
}
