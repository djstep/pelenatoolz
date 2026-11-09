import Link from "next/link";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { BudgetTemplateWorkspace } from "@/features/smeta/components/budget-template-workspace";
import { canEditBudgetTemplate, canOpenSmeta } from "@/features/smeta/lib/smeta-access";
import { listTemplateArticles } from "@/features/smeta/template-queries";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

/** Общий шаблон статей сметы фильма: ведёт продюсер, остальные с доступом к сметам видят. */
export default async function SmetaTemplatePage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!canOpenSmeta(ctx)) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к сметам</p>;
  }

  const articles = await listTemplateArticles(projectId);
  const canEdit = canEditBudgetTemplate(ctx);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[27px] font-bold leading-tight">Шаблон статей</h2>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            {canEdit
              ? "Общие статьи сметы фильма. Новые статьи добавляет продюсер."
              : "Общие статьи сметы фильма. Список ведёт продюсер."}
          </p>
        </div>
        <Link
          href={`/${locale}/projects/${projectId}/smeta`}
          className="rounded-md border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--nav-hover-bg)]"
        >
          К сметам
        </Link>
      </div>
      <BudgetTemplateWorkspace projectId={projectId} articles={articles} canEdit={canEdit} />
    </div>
  );
}
