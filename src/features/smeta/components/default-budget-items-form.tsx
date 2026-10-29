"use client";

import { useActionState, useState } from "react";
import {
  saveDefaultBudgetItemsAction,
  type DefaultBudgetItemsState,
  type DefaultBudgetItemsTarget,
} from "@/features/smeta/default-items-actions";
import { BudgetItemSelect } from "@/features/smeta/components/budget-item-select";
import {
  budgetItemLabel,
  type BudgetItemOption,
} from "@/features/smeta/lib/budget-item-option";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

const initial: DefaultBudgetItemsState = {};

export type DefaultBudgetItemsValues = {
  defaultBudgetItemId: string | null;
  overtimeBudgetItemId: string | null;
  mileageBudgetItemId?: string | null;
};

/**
 * Статьи сметы по умолчанию в карточке: на них отчёт смены начисляет оплату. Основная —
 * смена и доплаты; переработка и км — свои, если заданы, иначе основная.
 */
export function DefaultBudgetItemsForm({
  projectId,
  target,
  entityId,
  values,
  items,
  itemLabels,
  canEdit,
  showMileage = false,
}: {
  projectId: string;
  target: DefaultBudgetItemsTarget;
  entityId: string;
  values: DefaultBudgetItemsValues;
  items: BudgetItemOption[];
  itemLabels: Record<string, BudgetItemOption>;
  canEdit: boolean;
  showMileage?: boolean;
}) {
  const bound = saveDefaultBudgetItemsAction.bind(null, projectId, target, entityId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard(canEdit, entityId, state);
  useActionSuccess(state, markClean);

  const [main, setMain] = useState(values.defaultBudgetItemId ?? "");
  const [overtime, setOvertime] = useState(values.overtimeBudgetItemId ?? "");
  const [mileage, setMileage] = useState(values.mileageBudgetItemId ?? "");

  const fields = [
    {
      name: "defaultBudgetItemId",
      label: "Основная оплата (смена, доплаты)",
      value: main,
      set: setMain,
      empty: "Без статьи",
    },
    {
      name: "overtimeBudgetItemId",
      label: "Переработка",
      value: overtime,
      set: setOvertime,
      empty: "Как основная",
    },
    ...(showMileage
      ? [
          {
            name: "mileageBudgetItemId",
            label: "Километраж",
            value: mileage,
            set: setMileage,
            empty: "Как основная",
          },
        ]
      : []),
  ];

  if (!canEdit) {
    return (
      <div className="space-y-2 text-sm">
        <h4 className="font-semibold">Статьи сметы по умолчанию</h4>
        <dl className="grid gap-2 md:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name}>
              <dt className="text-[var(--muted-fg)]">{f.label}</dt>
              <dd>
                {f.value ? budgetItemLabel(itemLabels[f.value]) : f.empty}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  return (
    <form ref={ref} action={action} className="space-y-3">
      <div>
        <h4 className="font-semibold">Статьи сметы по умолчанию</h4>
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          На эти статьи отчёт смены начисляет оплату. В списке — статьи смет, которые вы видите.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name}>
            <Label htmlFor={`${entityId}-${f.name}`}>{f.label}</Label>
            <BudgetItemSelect
              id={`${entityId}-${f.name}`}
              name={f.name}
              value={f.value}
              onChange={f.set}
              options={items}
              current={f.value ? itemLabels[f.value] : null}
              emptyLabel={f.empty}
            />
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Сохранить статьи"}
      </Button>
    </form>
  );
}
