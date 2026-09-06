"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { CounterpartyType, FinanceOpCategory, FinanceOpType } from "@prisma/client";
import {
  quickCreateCompanyAction,
  quickCreateCounterpartyAction,
} from "@/features/counterparties/actions";
import {
  CounterpartyQuickCreateFields,
  EntityPicker,
  type PickerOption,
} from "@/features/counterparties/components/entity-picker";
import { counterpartyTypeLabels } from "@/features/counterparties/labels";
import {
  createFinanceOpAction,
  deleteFinanceOpAction,
  updateFinanceOpAction,
  type FinanceActionState,
} from "@/features/finance/actions";
import { financeCounterpartyLabel } from "@/features/finance/lib/labels";
import {
  financeOpCategoryLabels,
  financeOpTypeLabels,
} from "@/shared/i18n/finance-post-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
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
  companyId: string | null;
  counterpartyId: string | null;
  notes: string | null;
  actorId: string | null;
  actor: ActorOpt | null;
  company: { id: string; name: string } | null;
  counterpartyEntity: {
    id: string;
    name: string;
    type: CounterpartyType;
  } | null;
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
  projectId,
  op,
  actors,
  companies,
  counterparties,
}: {
  projectId: string;
  op?: Op;
  actors: ActorOpt[];
  companies: PickerOption[];
  counterparties: Array<PickerOption & { type?: CounterpartyType }>;
}) {
  const [companyId, setCompanyId] = useState(op?.companyId ?? "");
  const [counterpartyId, setCounterpartyId] = useState(
    op?.counterpartyId ?? "",
  );
  const [companyOpts, setCompanyOpts] = useState(companies);
  const [cpOpts, setCpOpts] = useState(counterparties);

  useEffect(() => {
    setCompanyOpts(companies);
  }, [companies]);
  useEffect(() => {
    setCpOpts(counterparties);
  }, [counterparties]);

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
        <EntityPicker
          name="companyId"
          label="Компания (наше юрлицо)"
          options={companyOpts}
          value={companyId}
          onChange={setCompanyId}
          placeholder="Поиск компании…"
          createTitle="Новая компания"
          onQuickCreate={async (fd) => {
            const name = String(fd.get("name") ?? "");
            const result = await quickCreateCompanyAction(projectId, name);
            if ("id" in result) {
              setCompanyOpts((prev) => {
                if (prev.some((o) => o.id === result.id)) return prev;
                return [{ id: result.id, name: result.name, usageCount: 0 }, ...prev];
              });
            }
            return result;
          }}
        />
      </div>
      <div>
        <EntityPicker
          name="counterpartyId"
          label="Контрагент"
          options={cpOpts.map((o) => ({
            ...o,
            subtitle: o.type ? counterpartyTypeLabels[o.type] : undefined,
          }))}
          value={counterpartyId}
          onChange={setCounterpartyId}
          placeholder="Поиск контрагента…"
          createTitle="Новый контрагент"
          createFields={<CounterpartyQuickCreateFields />}
          onQuickCreate={async (fd) => {
            const name = String(fd.get("name") ?? "");
            const type = (String(fd.get("type") ?? "LEGAL_ENTITY") ||
              "LEGAL_ENTITY") as CounterpartyType;
            const result = await quickCreateCounterpartyAction(
              projectId,
              name,
              type,
            );
            if ("id" in result) {
              setCpOpts((prev) => {
                if (prev.some((o) => o.id === result.id)) return prev;
                return [
                  {
                    id: result.id,
                    name: result.name,
                    usageCount: 0,
                    type,
                  },
                  ...prev,
                ];
              });
            }
            return result;
          }}
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
  companies,
  counterparties,
  open,
  onClose,
}: {
  projectId: string;
  op?: Op;
  actors: ActorOpt[];
  companies: PickerOption[];
  counterparties: Array<PickerOption & { type?: CounterpartyType }>;
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
        <OpForm
          projectId={projectId}
          op={op}
          actors={actors}
          companies={companies}
          counterparties={counterparties}
        />
      </form>
    </Modal>
  );
}

export function FinanceWorkspace({
  projectId,
  currency,
  operations,
  actors,
  companies,
  counterparties,
  canWrite,
}: {
  projectId: string;
  currency: string;
  operations: Op[];
  actors: ActorOpt[];
  companies: PickerOption[];
  counterparties: Array<PickerOption & { type?: CounterpartyType }>;
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
              "Компания",
              "Актёр",
              "Комментарий",
            ];
            const escape = (v: string) =>
              /[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            const rows = operations.map((op) => [
              formatDateShort(op.operationDate),
              financeOpTypeLabels[op.type],
              financeOpCategoryLabels[op.category],
              op.title,
              op.amount.toString(),
              financeCounterpartyLabel(op) ?? "",
              op.company?.name ?? "",
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
                    {formatDateShort(op.operationDate)}
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
                    {financeCounterpartyLabel(op) || "—"}
                    {op.company ? (
                      <div className="text-[10px] opacity-70">
                        от {op.company.name}
                      </div>
                    ) : null}
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
        companies={companies}
        counterparties={counterparties}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <OpModal
        projectId={projectId}
        op={editing ?? undefined}
        actors={actors}
        companies={companies}
        counterparties={counterparties}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
