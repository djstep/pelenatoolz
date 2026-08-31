import { notFound } from "next/navigation";
import { CastingPersonDetail } from "@/features/casting/components/casting-person-detail";
import {
  getCastingPerson,
  listCharactersForCasting,
} from "@/features/casting/queries";
import { PreproductionTabs } from "@/features/preproduction/components/preproduction-tabs";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; personId: string }>;
};

export default async function CastingPersonPage({ params }: Props) {
  const { locale, projectId, personId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [person, characters] = await Promise.all([
    getCastingPerson(projectId, personId),
    listCharactersForCasting(projectId),
  ]);

  if (!person) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Препродакшн</h2>
        <PreproductionTabs locale={locale} projectId={projectId} />
      </div>
      <Card>
        <CastingPersonDetail
          projectId={projectId}
          locale={locale}
          person={person}
          characters={characters}
          canWrite={ctx.can("cast:write")}
        />
      </Card>
    </div>
  );
}
