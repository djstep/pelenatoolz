import { notFound } from "next/navigation";
import { CharacterDetailView } from "@/features/characters/components/character-detail-view";
import { getCharacterDetail } from "@/features/characters/queries";
import {
  loadCastListExportBundle,
  serializeCastListBundle,
} from "@/features/casting/lib/cast-list-export-data";
import { getAvailabilityMiniBundle } from "@/features/actor-availability/lib/serialize-bundle";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { DefaultBudgetItemsCard } from "@/features/smeta/components/default-budget-items-card";
import { serializeForClient } from "@/shared/db/serialize-decimal";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; characterId: string }>;
};

export default async function CharacterDetailPage({ params }: Props) {
  const { locale, projectId, characterId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("characters:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  // Кандидаты, актёр, его занятость и каст-лист (с телефонами) — только с правом «Актёры».
  const canReadCast = ctx.can("cast:read");
  const [character, availability, castBundle] = await Promise.all([
    getCharacterDetail(projectId, characterId, ctx.canFinanceRead("actors"), canReadCast),
    canReadCast ? getAvailabilityMiniBundle(projectId) : null,
    canReadCast ? loadCastListExportBundle(projectId, characterId, locale) : null,
  ]);
  if (!character) notFound();

  const actor = character.actors[0];
  const actorId = actor?.id;

  return (
    <div className="space-y-4">
      <Card>
        <CharacterDetailView
          projectId={projectId}
          locale={locale}
          character={serializeForClient(character)}
          castListBundle={
            castBundle ? serializeCastListBundle(castBundle) : null
          }
          canWriteScript={ctx.can("characters:write")}
          canReadScreenplay={ctx.can("screenplay:read")}
          canReadCast={canReadCast}
          canWriteCast={canReadCast && ctx.can("cast:write")}
          canFinanceRead={ctx.canFinanceRead("actors")}
          canFinanceWrite={ctx.canFinanceWrite("actors")}
          availabilityMini={
            actorId && availability
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
      {actor && ctx.canFinanceRead("actors") ? (
        <DefaultBudgetItemsCard
          projectId={projectId}
          access={ctx}
          target="actor"
          entityId={actor.id}
          values={{
            defaultBudgetItemId: actor.defaultBudgetItemId ?? null,
            overtimeBudgetItemId: actor.overtimeBudgetItemId ?? null,
          }}
          canEdit={ctx.can("cast:write") && ctx.canFinanceWrite("actors")}
        />
      ) : null}
    </div>
  );
}
