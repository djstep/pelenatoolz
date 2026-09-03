import { requireProjectContext } from "@/features/projects/lib/project-context";
import { getScheduleAvailabilityClientBundle } from "@/features/actor-availability/lib/serialize-bundle";
import { ClearScheduleButton } from "@/features/schedule/components/clear-schedule-button";
import { KppExportMenu } from "@/features/schedule/components/kpp-export-modal";
import { ScheduleDnDBoard } from "@/features/schedule/components/schedule-dnd-board";
import { ShootDayForm } from "@/features/schedule/components/shoot-day-form";
import {
  getScheduleStats,
  listShootDays,
  listUnscheduledScenes,
} from "@/features/schedule/queries";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function SchedulePage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("schedule:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к КПП</p>;
  }

  const [shootDays, unscheduled, stats, availability] = await Promise.all([
    listShootDays(projectId),
    listUnscheduledScenes(projectId),
    getScheduleStats(projectId),
    getScheduleAvailabilityClientBundle(projectId),
  ]);
  const canWrite = ctx.can("schedule:write");
  const nextDayNumber =
    shootDays.length > 0
      ? Math.max(...shootDays.map((d) => d.dayNumber)) + 1
      : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">КПП и вызывные</h2>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              Фильтры слева · перетаскивание сцены за блок · клик — подробности · ⋮
              — меню дня (комментарий, тип, вызывной)
            </p>
          </div>
          <KppExportMenu
            projectId={projectId}
            projectType={ctx.project.type}
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ShootDayForm
            projectId={projectId}
            nextDayNumber={nextDayNumber}
            canWrite={canWrite}
          />
          <ClearScheduleButton
            projectId={projectId}
            dayCount={stats.days}
            assignedCount={stats.assigned}
            canWrite={canWrite}
          />
        </div>
      </div>

      <div className="min-h-[24rem] flex-1">
        <ScheduleDnDBoard
          projectId={projectId}
          locale={locale}
          shootDays={shootDays}
          unscheduled={unscheduled}
          canWrite={canWrite}
          availability={availability}
        />
      </div>
    </div>
  );
}
