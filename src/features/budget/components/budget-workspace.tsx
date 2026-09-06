"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  BudgetCategory,
  BudgetLineType,
  BudgetLinkedResourceType,
} from "@prisma/client";
import {
  createBudgetLineAction,
  deleteBudgetLineAction,
  updateBudgetLineAction,
  type BudgetActionState,
} from "@/features/budget/actions";
import {
  budgetCategoryLabels,
  budgetLineTypeLabels,
} from "@/features/budget/labels";
import {
  computeBudgetLinePlanned,
  defaultQuantityVariableKey,
  quantityLabelForType,
  rateLabelForType,
} from "@/features/budget/lib/line-calc";
import type { FinanceVariableRow } from "@/features/finance/queries-variables";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";

const initial: BudgetActionState = {};

type CounterpartyOption = { id: string; name: string };
type ActorOpt = {
  id: string;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
};
type ResourceOpt = { id: string; name: string; categoryName: string };

type Line = {
  id: string;
  category: BudgetCategory;
  lineType: BudgetLineType;
  title: string;
  description: string | null;
  unitsCount: { toString(): string };
  quantity: { toString(): string };
  quantityVariableKey: string | null;
  quantityAdjustment: { toString(): string };
  unitCost: { toString(): string };
  planned: { toString(): string };
  actual: { toString(): string };
  plannedCounterpartyId: string | null;
  taxPercent: { toString(): string } | null;
  linkedResourceType: BudgetLinkedResourceType | null;
  linkedResourceId: string | null;
  plannedCounterparty?: { id: string; name: string } | null;
};

function actorLabel(a: ActorOpt) {
  return [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" ");
}

function money(n: number, currency: string) {
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function LineFormFields({
  line,
  variables,
  counterparties,
  actors,
  resources,
}: {
  line?: Line;
  variables: FinanceVariableRow[];
  counterparties: CounterpartyOption[];
  actors: ActorOpt[];
  resources: ResourceOpt[];
}) {
  const [lineType, setLineType] = useState<BudgetLineType>(
    line?.lineType ?? BudgetLineType.ONE_TIME,
  );
  const [variableKey, setVariableKey] = useState(
    line?.quantityVariableKey ??
      defaultQuantityVariableKey(line?.lineType ?? BudgetLineType.ONE_TIME) ??
      "",
  );
  const [adjustment, setAdjustment] = useState(
    line ? Number(line.quantityAdjustment) : 0,
  );
  const [unitsCount, setUnitsCount] = useState(
    line ? Number(line.unitsCount) : 1,
  );
  const [unitCost, setUnitCost] = useState(line ? Number(line.unitCost) : 0);
  const [manualQuantity, setManualQuantity] = useState(
    line ? Number(line.quantity) : 1,
  );
  const [linkedType, setLinkedType] = useState<string>(
    line?.linkedResourceType ?? "",
  );
  const [linkedId, setLinkedId] = useState(line?.linkedResourceId ?? "");

  const selectedVar = variables.find((v) => v.key === variableKey);
  const periodUsesVariable =
    lineType === "PER_SHIFT" ||
    lineType === "MONTHLY" ||
    lineType === "DAILY";

  const quantity = periodUsesVariable
    ? Math.max(0, (selectedVar?.value ?? 0) + adjustment)
    : lineType === "ONE_TIME"
      ? 1
      : manualQuantity;

  const plannedPreview = computeBudgetLinePlanned({
    lineType,
    unitsCount,
    quantity,
    unitCost,
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="title">Название *</Label>
        <Input
          id="title"
          name="title"
          required
          defaultValue={line?.title}
          placeholder="Аренда камеры / гонорар и т.д."
        />
      </div>

      <div>
        <Label htmlFor="lineType">Тип статьи</Label>
        <Select
          id="lineType"
          name="lineType"
          value={lineType}
          onChange={(e) => {
            const next = e.target.value as BudgetLineType;
            setLineType(next);
            const def = defaultQuantityVariableKey(next);
            if (def) setVariableKey(def);
            else if (next === "ONE_TIME") setVariableKey("");
          }}
        >
          {(Object.keys(budgetLineTypeLabels) as BudgetLineType[]).map((t) => (
            <option key={t} value={t}>
              {budgetLineTypeLabels[t]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="category">Категория</Label>
        <Select
          id="category"
          name="category"
          defaultValue={line?.category ?? BudgetCategory.OTHER}
        >
          {(Object.keys(budgetCategoryLabels) as BudgetCategory[]).map((c) => (
            <option key={c} value={c}>
              {budgetCategoryLabels[c]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="linkedResourceType">Связанный ресурс</Label>
        <Select
          id="linkedResourceType"
          name="linkedResourceType"
          value={linkedType}
          onChange={(e) => {
            setLinkedType(e.target.value);
            setLinkedId("");
          }}
        >
          <option value="">— нет —</option>
          <option value="ACTOR">Актёр</option>
          <option value="RESOURCE_ITEM">Ресурс</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="linkedResourceId">Актёр / ресурс</Label>
        {linkedType === "ACTOR" ? (
          <Select
            id="linkedResourceId"
            name="linkedResourceId"
            value={linkedId}
            onChange={(e) => setLinkedId(e.target.value)}
          >
            <option value="">— выберите —</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {actorLabel(a)}
              </option>
            ))}
          </Select>
        ) : linkedType === "RESOURCE_ITEM" ? (
          <Select
            id="linkedResourceId"
            name="linkedResourceId"
            value={linkedId}
            onChange={(e) => setLinkedId(e.target.value)}
          >
            <option value="">— выберите —</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.categoryName}: {r.name}
              </option>
            ))}
          </Select>
        ) : (
          <input type="hidden" name="linkedResourceId" value="" />
        )}
      </div>

      {lineType === "PER_SHIFT" ? (
        <div>
          <Label htmlFor="unitsCount">Человек / единиц</Label>
          <Input
            id="unitsCount"
            name="unitsCount"
            type="number"
            min={0}
            step="0.01"
            value={unitsCount}
            onChange={(e) => setUnitsCount(Number(e.target.value))}
          />
        </div>
      ) : (
        <input type="hidden" name="unitsCount" value={1} />
      )}

      <div>
        <Label htmlFor="unitCost">{rateLabelForType(lineType)}</Label>
        <Input
          id="unitCost"
          name="unitCost"
          type="number"
          min={0}
          step="0.01"
          value={unitCost}
          onChange={(e) => setUnitCost(Number(e.target.value))}
        />
      </div>

      {periodUsesVariable ? (
        <>
          <div>
            <Label htmlFor="quantityVariableKey">Переменная периода</Label>
            <Select
              id="quantityVariableKey"
              name="quantityVariableKey"
              value={variableKey}
              onChange={(e) => setVariableKey(e.target.value)}
            >
              <option value="">— вручную —</option>
              {variables.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label} ({v.value})
                </option>
              ))}
            </Select>
          </div>
          {variableKey ? (
            <div>
              <Label htmlFor="quantityAdjustment">
                Корректировка (+/−) к «{selectedVar?.label ?? variableKey}»
              </Label>
              <Input
                id="quantityAdjustment"
                name="quantityAdjustment"
                type="number"
                step="1"
                value={adjustment}
                onChange={(e) => setAdjustment(Number(e.target.value))}
              />
              <p className="mt-1 text-[11px] text-[var(--muted-fg)]">
                Итого {quantityLabelForType(lineType).toLowerCase()}:{" "}
                {quantity}
                {selectedVar ? ` (${selectedVar.value} + ${adjustment})` : ""}
              </p>
              <input type="hidden" name="quantity" value={quantity} />
            </div>
          ) : (
            <div>
              <Label htmlFor="quantity">{quantityLabelForType(lineType)}</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={0}
                step="0.01"
                value={manualQuantity}
                onChange={(e) => setManualQuantity(Number(e.target.value))}
              />
              <input type="hidden" name="quantityAdjustment" value={0} />
            </div>
          )}
        </>
      ) : (
        <>
          <input type="hidden" name="quantityVariableKey" value="" />
          <input type="hidden" name="quantityAdjustment" value={0} />
          <input type="hidden" name="quantity" value={1} />
        </>
      )}

      {periodUsesVariable ? (
        <>
          <div>
            <Label htmlFor="plannedCounterpartyId">
              Плановый контрагент
            </Label>
            <Select
              id="plannedCounterpartyId"
              name="plannedCounterpartyId"
              defaultValue={line?.plannedCounterpartyId ?? ""}
            >
              <option value="">— не указан —</option>
              {counterparties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="taxPercent">Налог %</Label>
            <Input
              id="taxPercent"
              name="taxPercent"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={
                line?.taxPercent != null ? Number(line.taxPercent) : ""
              }
              placeholder="опционально"
            />
          </div>
        </>
      ) : (
        <>
          <input type="hidden" name="plannedCounterpartyId" value="" />
          <input type="hidden" name="taxPercent" value="" />
        </>
      )}

      <div>
        <Label htmlFor="planned">План (итог)</Label>
        <Input
          id="planned"
          name="planned"
          type="number"
          min={0}
          step="0.01"
          defaultValue={line ? Number(line.planned) : undefined}
          placeholder={String(plannedPreview)}
        />
        <p className="mt-1 text-[11px] text-[var(--muted-fg)]">
          Авторасчёт: {plannedPreview.toLocaleString("ru-RU")}
        </p>
      </div>
      <div>
        <Label htmlFor="actual">Факт</Label>
        <Input
          id="actual"
          name="actual"
          type="number"
          min={0}
          step="0.01"
          defaultValue={line ? Number(line.actual) : 0}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="description">Комментарий</Label>
        <Input
          id="description"
          name="description"
          defaultValue={line?.description ?? ""}
        />
      </div>
    </div>
  );
}

function LineModal({
  projectId,
  line,
  variables,
  counterparties,
  actors,
  resources,
  open,
  onClose,
}: {
  projectId: string;
  line?: Line;
  variables: FinanceVariableRow[];
  counterparties: CounterpartyOption[];
  actors: ActorOpt[];
  resources: ResourceOpt[];
  open: boolean;
  onClose: () => void;
}) {
  const bound = line
    ? updateBudgetLineAction.bind(null, projectId, line.id)
    : createBudgetLineAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={line ? "Редактирование статьи" : "Новая статья сметы"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="budget-line-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="budget-line-form" action={action} key={line?.id ?? "new"}>
        <LineFormFields
          line={line}
          variables={variables}
          counterparties={counterparties}
          actors={actors}
          resources={resources}
        />
      </form>
    </Modal>
  );
}

export function BudgetWorkspace({
  projectId,
  currency,
  lines,
  variables,
  counterparties,
  actors,
  resources,
  canWrite,
}: {
  projectId: string;
  currency: string;
  lines: Line[];
  variables: FinanceVariableRow[];
  counterparties: CounterpartyOption[];
  actors: ActorOpt[];
  resources: ResourceOpt[];
  canWrite: boolean;
}) {
  const params = useParams();
  const locale = String(params.locale ?? "ru");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Line | null>(null);

  const totals = useMemo(() => {
    let planned = 0;
    let actual = 0;
    for (const line of lines) {
      planned += Number(line.planned);
      actual += Number(line.actual);
    }
    return { planned, actual, variance: planned - actual };
  }, [lines]);

  const byCategory = useMemo(() => {
    const map = new Map<BudgetCategory, Line[]>();
    for (const line of lines) {
      const list = map.get(line.category) ?? [];
      list.push(line);
      map.set(line.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) =>
      budgetCategoryLabels[a].localeCompare(budgetCategoryLabels[b], "ru"),
    );
  }, [lines]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            План
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(totals.planned, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Факт
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(totals.actual, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Остаток плана
          </div>
          <div
            className={`mt-1 text-xl font-semibold ${
              totals.variance < 0 ? "text-red-300" : "text-emerald-300"
            }`}
          >
            {money(totals.variance, currency)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setCreating(true)}>
            + Статья
          </Button>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Статей пока нет. Добавьте через форму — так сработают авторасчёты
          (посменные / период / налог).
        </p>
      ) : (
        <div className="space-y-4">
          {byCategory.map(([category, group]) => {
            const planned = group.reduce((s, l) => s + Number(l.planned), 0);
            const actual = group.reduce((s, l) => s + Number(l.actual), 0);
            return (
              <section
                key={category}
                className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
                  <h3 className="font-semibold">
                    {budgetCategoryLabels[category]}
                  </h3>
                  <p className="text-sm text-[var(--muted-fg)]">
                    план {money(planned, currency)} · факт{" "}
                    {money(actual, currency)}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                        <th className="px-4 py-2">Статья</th>
                        <th className="px-4 py-2">Тип</th>
                        <th className="px-4 py-2">Кол-во</th>
                        <th className="px-4 py-2">Ставка</th>
                        <th className="px-4 py-2">План</th>
                        <th className="px-4 py-2">Факт</th>
                        {canWrite ? <th className="px-4 py-2" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((line) => (
                        <tr
                          key={line.id}
                          className="border-b border-[var(--border)]/60"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium">{line.title}</div>
                            {line.plannedCounterparty ? (
                              <div className="text-xs text-[var(--muted-fg)]">
                                {line.plannedCounterparty.name}
                                {line.taxPercent != null
                                  ? ` · налог ${Number(line.taxPercent)}%`
                                  : ""}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-[var(--muted-fg)]">
                            {budgetLineTypeLabels[line.lineType]}
                          </td>
                          <td className="px-4 py-3">
                            {line.lineType === "PER_SHIFT"
                              ? `${Number(line.unitsCount)} × ${Number(line.quantity)}`
                              : Number(line.quantity)}
                          </td>
                          <td className="px-4 py-3">
                            {money(Number(line.unitCost), currency)}
                          </td>
                          <td className="px-4 py-3">
                            {money(Number(line.planned), currency)}
                          </td>
                          <td className="px-4 py-3">
                            {money(Number(line.actual), currency)}
                          </td>
                          {canWrite ? (
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex flex-wrap justify-end gap-1">
                                <Link
                                  href={`/${locale}/projects/${projectId}/accruals?create=one&lineId=${line.id}`}
                                >
                                  <Button type="button" variant="secondary">
                                    + Начисление
                                  </Button>
                                </Link>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => setEditing(line)}
                                >
                                  Изменить
                                </Button>
                                <form
                                  action={async () => {
                                    await deleteBudgetLineAction(
                                      projectId,
                                      line.id,
                                    );
                                  }}
                                >
                                  <Button type="submit" variant="danger">
                                    ×
                                  </Button>
                                </form>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <LineModal
        projectId={projectId}
        variables={variables}
        counterparties={counterparties}
        actors={actors}
        resources={resources}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <LineModal
        projectId={projectId}
        line={editing ?? undefined}
        variables={variables}
        counterparties={counterparties}
        actors={actors}
        resources={resources}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
