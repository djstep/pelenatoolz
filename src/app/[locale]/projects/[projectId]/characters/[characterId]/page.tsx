import { notFound } from "next/navigation";
import { CharacterDetailView } from "@/features/characters/components/character-detail-view";
import { getCharacterDetail } from "@/features/characters/queries";
import { getAvailabilityMiniBundle } from "@/features/actor-availability/lib/serialize-bundle";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; characterId: string }>;
};

export default async function CharacterDetailPage({ params }: Props) {
  const { locale, projectId, characterId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [character, availability] = await Promise.all([
    getCharacterDetail(projectId, characterId),
    getAvailabilityMiniBundle(projectId),
  ]);
  if (!character) notFound();

  const actorId = character.actors[0]?.id;

  return (
    <Card>
      <CharacterDetailView
        projectId={projectId}
        locale={locale}
        character={character}
        canWriteScript={ctx.can("script:write")}
        canWriteCast={ctx.can("cast:write")}
        availabilityMini={
          actorId
            ? {
                rowId: availability.rowByActorId[actorId],
                actorId,
                manualDays: availability.manualDays,
                kppBusySerialized: availability.kppBusySerialized,
              }
            : undefined
        }
      />
    </Card>
  );
}
