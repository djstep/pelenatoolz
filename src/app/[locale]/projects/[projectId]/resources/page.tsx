import { ResourcesIndex } from "@/features/resources/components/resources-index";
import { listResourceCategories } from "@/features/resources/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string }>;
};

export default async function ResourcesPage({ params }: Props) {
  const { locale, projectId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const categories = await listResourceCategories(projectId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold">Ресурсы</h2>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Категории и элементы ресурсов для планирования съёмок.
        </p>
      </div>
      <Card>
        <ResourcesIndex
          projectId={projectId}
          locale={locale}
          categories={categories}
          canWrite={ctx.can("script:write")}
        />
      </Card>
    </div>
  );
}
