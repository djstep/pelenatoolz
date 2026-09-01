import { notFound } from "next/navigation";
import { ItemDetailView } from "@/features/resources/components/item-detail-view";
import { getResourceItem } from "@/features/resources/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{
    locale: string;
    projectId: string;
    categoryId: string;
    itemId: string;
  }>;
};

export default async function ResourceItemPage({ params }: Props) {
  const { locale, projectId, categoryId, itemId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const item = await getResourceItem(projectId, categoryId, itemId);
  if (!item) notFound();

  return (
    <Card>
      <ItemDetailView
        projectId={projectId}
        locale={locale}
        projectType={ctx.project.type}
        item={item}
      />
    </Card>
  );
}
