import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ScriptImportWizard } from "@/features/import/components/script-import-wizard";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ projectId: string }>;
};

export default async function ScriptImportPage({ params }: Props) {
  const { projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Импорт сценария</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Загрузка Word-файла, расчёт хронометража и предпросмотр перед импортом.
        </p>
      </div>
      <Card>
        <ScriptImportWizard
          projectId={projectId}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
