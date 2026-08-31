"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { FinanceOpCategory, FinanceOpType } from "@prisma/client";
import {
  createFinanceOpAction,
  deleteFinanceOpAction,
  updateFinanceOpAction,
  type FinanceActionState,
} from "@/features/finance/actions";
import {
  financeOpCategoryLabels,
  financeOpTypeLabels,
} from "@/shared/i18n/finance-post-labels";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";
import { useActionToast } from "@/shared/ui/toast";

const initial: FinanceActionState = {};

type ActorOpt = {
  id: string;
  lastName: string;
  firstName: string | null;
  middleName: string | null;
};

type Op = {
  id: string;
  type: FinanceOpType;
  category: FinanceOpCategory;
  title: string;
  amount: { toString(): string };
  operationDate: Date;
  counterparty: string | null;
  notes: string | null;
  actorId: string | null;
  actor: ActorOpt | null;
};

function money(n: number, currency: string) {
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function actorName(a: ActorOpt) {
  return [a.lastName, a.firstName, a.middleName].filter(Boolean).join(" ");
}

function OpForm({
  op,
  actors,
}: {
  op?: Op;
  actors: ActorOpt[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="type">Тип</Label>
        <Select id="type" name="type" defaultValue={op?.type ?? "EXPENSE"}>
          {(Object.keys(financeOpTypeLabels) as FinanceOpType[]).map((t) => (
            <option key={t} value={t}>
              {financeOpTypeLabels[t]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="category">Категория</Label>
        <Select
          id="category"
          name="category"
          defaultValue={op?.category ?? "OTHER"}
        >
          {(Object.keys(financeOpCategoryLabels) as FinanceOpCategory[]).map(
            (c) => (
              <option key={c} value={c}>
                {financeOpCategoryLabels[c]}
              </option>
            ),
          )}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="title">Название *</Label>
        <Input
          id="title"
          name="title"
          required
          defaultValue={op?.title}
          placeholder="Выплата смены / аванс / грант…"
        />
      </div>
      <div>
        <Label htmlFor="amount">Сумма *</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          min={0.01}
          step="0.01"
          required
          defaultValue={op ? Number(op.amount) : undefined}
        />
      </div>
      <div>
        <Label htmlFor="operationDate">Дата *</Label>
        <Input
          id="operationDate"
          name="operationDate"
          type="date"
          required
          defaultValue={
            op
              ? new Date(op.operationDate).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10)
          }
        />
      </div>
      <div>
        <Label htmlFor="counterparty">Контрагент</Label>
        <Input
          id="counterparty"
          name="counterparty"
          defaultValue={op?.counterparty ?? ""}
        />
      </div>
      <div>
        <Label htmlFor="actorId">Актёр (опц.)</Label>
        <Select id="actorId" name="actorId" defaultValue={op?.actorId ?? ""}>
          <option value="">—</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {actorName(a)}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Комментарий</Label>
        <Input id="notes" name="notes" defaultValue={op?.notes ?? ""} />
      </div>
    </div>
  );
}

function OpModal({
  projectId,
  op,
  actors,
  open,
  onClose,
}: {
  projectId: string;
  op?: Op;
  actors: ActorOpt[];
  open: boolean;
  onClose: () => void;
}) {
  const bound = op
    ? updateFinanceOpAction.bind(null, projectId, op.id)
    : createFinanceOpAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={op ? "Редактирование операции" : "Новая операция"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="finance-op-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="finance-op-form" action={action} key={op?.id ?? "new"}>
        <OpForm op={op} actors={actors} />
      </form>
    </Modal>
  );
}

export function FinanceWorkspace({
  projectId,
  currency,
  operations,
  actors,
  canWrite,
}: {
  projectId: string;
  currency: string;
  operations: Op[];
  actors: ActorOpt[];
  canWrite: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Op | null>(null);
  const [filter, setFilter] = useState<"ALL" | FinanceOpType>("ALL");

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const op of operations) {
      const amount = Number(op.amount);
      if (op.type === "INCOME") income += amount;
      else expense += amount;
    }
    return { income, expense, balance: income - expense };
  }, [operations]);

  const visible = useMemo(
    () =>
      filter === "ALL"
        ? operations
        : operations.filter((op) => op.type === filter),
    [operations, filter],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Приход
          </div>
          <div className="mt-1 text-xl font-semibold text-emerald-300">
            {money(totals.income, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Расход
          </div>
          <div className="mt-1 text-xl font-semibold text-red-300">
            {money(totals.expense, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Баланс
          </div>
          <div
            className={cn(
              "mt-1 text-xl font-semibold",
              totals.balance < 0 ? "text-red-300" : "text-emerald-300",
            )}
          >
            {money(totals.balance, currency)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setCreating(true)}>
            + Операция
          </Button>
        ) : null}
        <div className="flex rounded-lg border border-[var(--border)] p-0.5">
          {(
            [
              ["ALL", "Все"],
              ["INCOME", "Приход"],
              ["EXPENSE", "Расход"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn(
                "rounded-md px-3 py-1.5 text-xs",
                filter === value
                  ? "bg-white/10 text-white"
                  : "text-[var(--muted-fg)] hover:text-white",
              )}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={operations.length === 0}
          onClick={() => {
            const header = [
              "Дата",
              "Тип",
              "Категория",
              "Название",
              "Сумма",
              "Контрагент",
              "Актёр",
              "Комментарий",
            ];
            const escape = (v: string) =>
              /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            const rows = operations.map((op) => [
              new Date(op.operationDate).toLocaleDateString("ru-RU"),
              financeOpTypeLabels[op.type],
              financeOpCategoryLabels[op.category],
              op.title,
              op.amount.toString(),
              op.counterparty ?? "",
              op.actor ? actorName(op.actor) : "",
              op.notes ?? "",
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
            a.download = `finance-${projectId.slice(0, 8)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Экспорт CSV
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Операций пока нет. Добавьте приход или расход.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Операция</th>
                <th className="px-4 py-3">Категория</th>
                <th className="px-4 py-3">Сумма</th>
                <th className="px-4 py-3">Контрагент</th>
                {canWrite ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((op) => (
                <tr key={op.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {new Date(op.operationDate).toLocaleDateString("ru-RU")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-xs",
                        op.type === "INCOME"
                          ? "border-emerald-500/30 text-emerald-300"
                          : "border-red-500/30 text-red-300",
                      )}
                    >
                      {financeOpTypeLabels[op.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{op.title}</div>
                    {op.actor ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        {actorName(op.actor)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {financeOpCategoryLabels[op.category]}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 font-medium whitespace-nowrap",
                      op.type === "INCOME" ? "text-emerald-300" : "text-red-300",
                    )}
                  >
                    {op.type === "INCOME" ? "+" : "−"}
                    {money(Number(op.amount), currency)}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {op.counterparty || "—"}
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditing(op)}
                        >
                          Изменить
                        </Button>
                        <form
                          action={async () => {
                            await deleteFinanceOpAction(projectId, op.id);
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
      )}

      <OpModal
        projectId={projectId}
        actors={actors}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <OpModal
        projectId={projectId}
        op={editing ?? undefined}
        actors={actors}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
