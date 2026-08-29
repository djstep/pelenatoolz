"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { BudgetCategory } from "@prisma/client";
import {
  createBudgetLineAction,
  deleteBudgetLineAction,
  updateBudgetLineAction,
  type BudgetActionState,
} from "@/features/budget/actions";
import { budgetCategoryLabels } from "@/features/budget/labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";

const initial: BudgetActionState = {};

type Line = {
  id: string;
  category: BudgetCategory;
  title: string;
  description: string | null;
  quantity: { toString(): string };
  unitCost: { toString(): string };
  planned: { toString(): string };
  actual: { toString(): string };
};

function money(n: number, currency: string) {
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function LineFormFields({ line }: { line?: Line }) {
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
        <Label htmlFor="quantity">Кол-во</Label>
        <Input
          id="quantity"
          name="quantity"
          type="number"
          min={0}
          step="0.01"
          defaultValue={line ? Number(line.quantity) : 1}
        />
      </div>
      <div>
        <Label htmlFor="unitCost">Цена за ед.</Label>
        <Input
          id="unitCost"
          name="unitCost"
          type="number"
          min={0}
          step="0.01"
          defaultValue={line ? Number(line.unitCost) : 0}
        />
      </div>
      <div>
        <Label htmlFor="planned">План (итог)</Label>
        <Input
          id="planned"
          name="planned"
          type="number"
          min={0}
          step="0.01"
          defaultValue={line ? Number(line.planned) : undefined}
          placeholder="кол-во × цена"
        />
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
  open,
  onClose,
}: {
  projectId: string;
  line?: Line;
  open: boolean;
  onClose: () => void;
}) {
  const bound = line
    ? updateBudgetLineAction.bind(null, projectId, line.id)
    : createBudgetLineAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);

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
          {state.error ? (
            <span className="text-sm text-[var(--danger)]">{state.error}</span>
          ) : null}
        </div>
      }
    >
      <form id="budget-line-form" action={action} key={line?.id ?? "new"}>
        <LineFormFields line={line} />
      </form>
    </Modal>
  );
}

export function BudgetWorkspace({
  projectId,
  currency,
  lines,
  canWrite,
}: {
  projectId: string;
  currency: string;
  lines: Line[];
  canWrite: boolean;
}) {
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
        <Button
          type="button"
          variant="secondary"
          disabled={lines.length === 0}
          onClick={() => {
            const header = [
              "Категория",
              "Название",
              "Кол-во",
              "Цена",
              "План",
              "Факт",
              "Комментарий",
            ];
            const escape = (v: string) =>
              /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            const rows = lines.map((l) => [
              budgetCategoryLabels[l.category],
              l.title,
              l.quantity.toString(),
              l.unitCost.toString(),
              l.planned.toString(),
              l.actual.toString(),
              l.description ?? "",
            ]);
            const csv = [header, ...rows]
              .map((r) => r.map((c) => escape(String(c))).join(";"))
              .join("\n");
            const blob = new Blob(["\uFEFF" + csv], {
              type: "text/csv;charset=utf-8",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `budget-${projectId.slice(0, 8)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Экспорт CSV
        </Button>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Статей сметы пока нет. Добавьте первую.
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
                        <th className="px-4 py-2">Кол-во</th>
                        <th className="px-4 py-2">Цена</th>
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
                            {line.description ? (
                              <div className="text-xs text-[var(--muted-fg)]">
                                {line.description}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {Number(line.quantity)}
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
                              <div className="inline-flex gap-1">
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
        open={creating}
        onClose={() => setCreating(false)}
      />
      <LineModal
        projectId={projectId}
        line={editing ?? undefined}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
