import { notFound } from "next/navigation";
import { CategoryWorkspace } from "@/features/resources/components/category-workspace";
import { getResourceCategory } from "@/features/resources/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{ locale: string; projectId: string; categoryId: string }>;
};

export default async function ResourceCategoryPage({ params }: Props) {
  const { locale, projectId, categoryId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const category = await getResourceCategory(projectId, categoryId);
  if (!category) notFound();

  return (
    <Card>
      <CategoryWorkspace
        projectId={projectId}
        locale={locale}
        projectType={ctx.project.type}
        category={category}
        canWrite={ctx.can("script:write")}
      />
    </Card>
  );
}
