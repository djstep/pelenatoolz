import { CastingWorkspace } from "@/features/casting/components/casting-workspace";
import {
  listCastingPeople,
  listCharactersForCasting,
} from "@/features/casting/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { financeAccess } from "@/shared/lib/finance-fields";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ character?: string | string[] }>;
};

export default async function CastingPage({ params, searchParams }: Props) {
  const { locale, projectId } = await params;
  const { character } = await searchParams;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [people, characters] = await Promise.all([
    listCastingPeople(projectId, ctx.canFinanceRead("actors")),
    listCharactersForCasting(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">Кастинг</h2>
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
          finance={financeAccess(ctx.canFinanceRead("actors"), ctx.canFinanceWrite("actors"))}
          characterFilter={typeof character === "string" ? character : undefined}
        />
      </Card>
    </div>
  );
}
