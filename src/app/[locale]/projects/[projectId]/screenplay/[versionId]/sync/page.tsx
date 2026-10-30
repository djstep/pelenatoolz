import Link from "next/link";
import { notFound } from "next/navigation";
import { ScriptReview } from "@/features/import/components/script-review";
import { loadSyncReview } from "@/features/import/review/load-sync";
import { requireProjectContext } from "@/features/projects/lib/project-context";

type Props = {
  params: Promise<{ locale: string; projectId: string; versionId: string }>;
};

/** «Обновить в либретто»: тот же экран проверки, что у импорта, источник — блоки версии. */
export default async function ScreenplaySyncPage({ params }: Props) {
  const { locale, projectId, versionId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:write")) {
    return (
      <p className="text-sm text-[var(--danger)]">
        Нет доступа: обновить либретто из версии можно только с правом правки сценария
      </p>
    );
  }

  // Только чтение: предпросмотр ничего не пишет.
  const data = await loadSyncReview(projectId, versionId);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/projects/${projectId}/screenplay/${versionId}`}
          className="text-xs text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          ← К версии
        </Link>
        <h2 className="font-display text-2xl font-semibold">Обновить либретто из версии</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Сцены версии сопоставляются со сценами либретто. Текст версии не меняется; меняются
          сцены, персонажи, локации и связи в либретто — только после «Обновить либретто».
          Предложенный ответ сам в либретто не записывается.
        </p>
      </div>
      <ScriptReview projectId={projectId} locale={locale} file={null} data={data} />
    </div>
  );
}
