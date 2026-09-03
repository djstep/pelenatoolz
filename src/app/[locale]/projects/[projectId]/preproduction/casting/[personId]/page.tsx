import { notFound } from "next/navigation";
import { PersonAuditionsBlock } from "@/features/auditions/components/person-auditions-block";
import {
  listAuditionsForPerson,
  listCastingPeopleBrief,
  listScenesBriefForAuditions,
} from "@/features/auditions/queries";
import { CastingPersonDetail } from "@/features/casting/components/casting-person-detail";
import {
  getCastingPerson,
  listCharactersForCasting,
} from "@/features/casting/queries";
import { getAvailabilityMiniBundle } from "@/features/actor-availability/lib/serialize-bundle";
import { fullNameFromParts } from "@/features/preproduction/lib/snapshots";
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

  const [person, characters, availability, auditions, people, scenes] =
    await Promise.all([
      getCastingPerson(projectId, personId),
      listCharactersForCasting(projectId),
      getAvailabilityMiniBundle(projectId),
      listAuditionsForPerson(projectId, personId),
      listCastingPeopleBrief(projectId),
      listScenesBriefForAuditions(projectId),
    ]);

  if (!person) notFound();

  const presetCharacterId = person.candidates[0]?.character.id;

  return (
    <div className="space-y-6">
      <Card>
        <CastingPersonDetail
          projectId={projectId}
          locale={locale}
          person={person}
          characters={characters}
          canWrite={ctx.can("cast:write")}
          availabilityMini={{
            rowId: availability.rowByPersonId[personId],
            manualDays: availability.manualDays,
            kppBusySerialized: availability.kppBusySerialized,
          }}
          auditionsSlot={
            <PersonAuditionsBlock
              projectId={projectId}
              personId={person.id}
              personLabel={fullNameFromParts(person)}
              auditions={auditions}
              people={people}
              characters={characters}
              scenes={scenes}
              canWrite={ctx.can("cast:write")}
              presetCharacterId={presetCharacterId}
            />
          }
        />
      </Card>
    </div>
  );
}
