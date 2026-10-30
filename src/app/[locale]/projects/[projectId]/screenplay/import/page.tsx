import { requireProjectContext } from "@/features/projects/lib/project-context";
import { ScriptImportScreen } from "@/features/import/components/script-import-screen";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ScreenplayImportPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:write")) {
    return (
      <p className="text-sm text-[var(--danger)]">
        Нет доступа: импорт сценария доступен только с правом правки сценария
      </p>
    );
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
          Файл Word .docx приводится к одному виду: сцены, шапки, персонажи, реплики, переходы.
          Экран показывает только то, в чём программа не уверена. Импорт создаст новую версию
          сценария.
        </p>
      </div>
      <ScriptImportScreen projectId={projectId} locale={locale} />
    </div>
  );
}
