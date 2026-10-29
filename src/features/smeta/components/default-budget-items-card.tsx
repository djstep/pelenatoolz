import {
  describeBudgetItems,
  listVisibleBudgetItems,
} from "@/features/smeta/budget-item-access";
import {
  DefaultBudgetItemsForm,
  type DefaultBudgetItemsValues,
} from "@/features/smeta/components/default-budget-items-form";
import type { DefaultBudgetItemsTarget } from "@/features/smeta/default-items-actions";
import type { SmetaAccessContext } from "@/features/smeta/lib/smeta-access";
import { Card } from "@/shared/ui/card";

/** Блок «Статьи сметы по умолчанию» для карточки актёра, ресурса или объекта. */
export async function DefaultBudgetItemsCard({
  projectId,
  access,
  target,
  entityId,
  values,
  canEdit,
  showMileage,
}: {
  projectId: string;
  access: SmetaAccessContext;
  target: DefaultBudgetItemsTarget;
  entityId: string;
  values: DefaultBudgetItemsValues;
  canEdit: boolean;
  showMileage?: boolean;
}) {
  const [items, itemLabels] = await Promise.all([
    listVisibleBudgetItems(projectId, access),
    describeBudgetItems(projectId, access, Object.values(values)),
  ]);
  return (
    <Card className="p-5">
      <DefaultBudgetItemsForm
        projectId={projectId}
        target={target}
        entityId={entityId}
        values={values}
        items={items}
        itemLabels={itemLabels}
        canEdit={canEdit}
        showMileage={showMileage}
      />
    </Card>
  );
}
