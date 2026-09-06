import { SmetaTemplatesWorkspace } from "@/features/smeta/components/smeta-templates-workspace";
import { listBudgets, listBudgetTemplates } from "@/features/smeta/queries";
import { FinanceSectionTabs } from "@/features/finance/components/finance-section-tabs";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import Link from "next/link";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function SmetaTemplatesPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("budget:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа к смете</p>;
  }

  const [templates, budgets] = await Promise.all([
    listBudgetTemplates(projectId),
    listBudgets(projectId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[var(--muted-fg)]">
          <Link
            href={`/${locale}/projects/${projectId}/smeta`}
            className="underline-offset-2 hover:underline"
          >
            ← Смета
          </Link>
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold">
          Шаблоны сметы
        </h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Встроенный отраслевой и ваши сохранённые шаблоны
        </p>
      </div>

      <FinanceSectionTabs locale={locale} projectId={projectId} />

      <SmetaTemplatesWorkspace
        projectId={projectId}
        templates={templates}
        budgets={budgets}
        canWrite={ctx.can("budget:write")}
      />
    </div>
  );
}
