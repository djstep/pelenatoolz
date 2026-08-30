import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ScriptImportWizard } from "@/features/import/components/script-import-wizard";
import Link from "next/link";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ScreenplayImportPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/screenplay`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← Все версии
        </Link>
        <h2 className="font-display text-2xl font-semibold">Импорт сценария</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Импорт создаёт новую версию текста. Обновление либретто — отдельным
          шагом после импорта.
        </p>
      </div>
      <Card>
        <ScriptImportWizard
          projectId={projectId}
          locale={locale}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
