import { AuditionsHub } from "@/features/auditions/components/auditions-hub";
import {
  listAuditionScheduleBreaks,
  listAuditionSchedules,
  listScheduleCandidates,
} from "@/features/auditions/lib/schedule-queries";
import {
  listAuditions,
  listCastingPeopleBrief,
  listScenesBriefForAuditions,
} from "@/features/auditions/queries";
import { listCharactersForCasting } from "@/features/casting/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function AuditionsPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("cast:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const [
    auditions,
    people,
    characters,
    scenes,
    scheduleCandidates,
    schedules,
    scheduleBreaks,
  ] = await Promise.all([
    listAuditions(projectId),
    listCastingPeopleBrief(projectId),
    listCharactersForCasting(projectId),
    listScenesBriefForAuditions(projectId),
    listScheduleCandidates(projectId),
    listAuditionSchedules(projectId),
    listAuditionScheduleBreaks(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Кастинг-пробы</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Планирование вызовов и видеозаписи проб.
        </p>
      </div>
      <Card>
        <AuditionsHub
          projectId={projectId}
          locale={locale}
          auditions={auditions}
          people={people}
          characters={characters}
          scenes={scenes}
          scheduleCandidates={scheduleCandidates}
          schedules={schedules}
          scheduleBreaks={scheduleBreaks}
          canWrite={ctx.can("cast:write")}
        />
      </Card>
    </div>
  );
}
