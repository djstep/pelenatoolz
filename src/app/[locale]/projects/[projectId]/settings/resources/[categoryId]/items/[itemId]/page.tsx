import { notFound } from "next/navigation";
import { ItemDetailView } from "@/features/resources/components/item-detail-view";
import { getResourceItem } from "@/features/resources/queries";
import { requireProjectContext } from "@/features/projects/lib/project-context";
import { DefaultBudgetItemsCard } from "@/features/smeta/components/default-budget-items-card";
import { Card } from "@/shared/ui/card";

type Props = {
  params: Promise<{
    locale: string;
    projectId: string;
    categoryId: string;
    itemId: string;
  }>;
};

export default async function SettingsResourceItemPage({ params }: Props) {
  const { locale, projectId, categoryId, itemId } = await params;
  const ctx = await requireProjectContext(projectId);

  if (!ctx.can("script:read")) {
    return <p className="text-sm text-[var(--danger)]">Нет доступа</p>;
  }

  const item = await getResourceItem(projectId, categoryId, itemId);
  if (!item) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <ItemDetailView
          projectId={projectId}
          locale={locale}
          projectType={ctx.project.type}
          item={item}
          canFinanceRead={ctx.canFinanceRead({ categoryId })}
        />
      </Card>
      {ctx.canFinanceRead({ categoryId }) ? (
        <DefaultBudgetItemsCard
          projectId={projectId}
          access={ctx}
          target="resource"
          entityId={item.id}
          values={{
            defaultBudgetItemId: item.defaultBudgetItemId,
            overtimeBudgetItemId: item.overtimeBudgetItemId,
            mileageBudgetItemId: item.mileageBudgetItemId,
          }}
          canEdit={ctx.can("script:write") && ctx.canFinanceWrite({ categoryId })}
          showMileage={item.category.tracksMileage}
        />
      ) : null}
    </div>
  );
}
