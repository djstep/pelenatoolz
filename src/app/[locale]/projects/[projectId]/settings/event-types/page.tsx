import { EventTypesWorkspace } from "@/features/prep-calendar/components/event-types-workspace";
import { listPrepEventTypes } from "@/features/prep-calendar/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function SettingsEventTypesPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("calendar:write")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const types = await listPrepEventTypes(projectId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-[27px] font-bold leading-tight">Типы событий</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Справочник событий календаря препродакшена: название и цвет.
        </p>
      </div>
      <Card>
        <EventTypesWorkspace projectId={projectId} types={types} />
      </Card>
    </div>
  );
}
