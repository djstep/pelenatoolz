"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { AccrualType } from "@prisma/client";
import {
  createAccrualAction,
  deleteAccrualAction,
  suggestAccrualDefaultsAction,
  updateAccrualAction,
  type AccrualActionState,
} from "@/features/accruals/actions";
import { accrualTypeLabels, computeTaxAmounts } from "@/features/accruals/lib/labels";
import type { AccrualListRow } from "@/features/accruals/queries";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";
import { formatDateShort } from "@/shared/i18n/format-date";

const initial: AccrualActionState = {};

type LineOpt = {
  id: string;
  title: string;
  unitCost: { toString(): string } | number;
  unitsCount: { toString(): string } | number;
  taxPercent: { toString(): string } | number | null;
  plannedCounterpartyId: string | null;
};

type CpOpt = { id: string; name: string };
type DayOpt = {
  id: string;
  date: Date | string;
  dayNumber: number;
  unit: string | null;
};

function money(n: number, currency: string) {
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function toDateInput(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

function AccrualFormFields({
  projectId,
  accrual,
  lines,
  counterparties,
  shootDays,
  groupUnits,
  defaultType,
  defaultBudgetLineId,
  defaultDate,
}: {
  projectId: string;
  accrual?: AccrualListRow;
  lines: LineOpt[];
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  groupUnits: string[];
  defaultType?: AccrualType;
  defaultBudgetLineId?: string;
  defaultDate?: string;
}) {
  const [type, setType] = useState<AccrualType>(
    accrual?.type ?? defaultType ?? AccrualType.ONE_TIME,
  );
  const [budgetLineId, setBudgetLineId] = useState(
    accrual?.budgetLineId ?? defaultBudgetLineId ?? "",
  );
  const [counterpartyId, setCounterpartyId] = useState(
    accrual?.counterpartyId ?? "",
  );
  const [amount, setAmount] = useState(
    accrual ? Number(accrual.amount) : 0,
  );
  const [quantity, setQuantity] = useState(
    accrual?.quantity != null ? Number(accrual.quantity) : 1,
  );
  const [taxPercent, setTaxPercent] = useState(
    accrual?.taxPercent != null ? Number(accrual.taxPercent) : "",
  );
  const [date, setDate] = useState(
    accrual
      ? toDateInput(accrual.date)
      : defaultDate ?? new Date().toISOString().slice(0, 10),
  );
  const [shootDayId, setShootDayId] = useState(accrual?.shootDayId ?? "");
  const [pendingSuggest, startSuggest] = useTransition();

  const taxNum =
    taxPercent === "" ? null : Number(taxPercent);
  const withTax = computeTaxAmounts(amount, taxNum).amountWithTax;

  function applyLineDefaults(lineId: string) {
    startSuggest(async () => {
      const res = await suggestAccrualDefaultsAction(projectId, {
        budgetLineId: lineId,
        shootDayId: shootDayId || null,
      });
      if ("defaults" in res && res.defaults) {
        const d = res.defaults;
        if (d.counterpartyId) setCounterpartyId(d.counterpartyId);
        if (d.taxPercent != null) setTaxPercent(d.taxPercent);
        if (d.amount != null) setAmount(d.amount);
        if (d.quantity != null) setQuantity(d.quantity);
      } else {
        const line = lines.find((l) => l.id === lineId);
        if (line) {
          if (line.plannedCounterpartyId) {
            setCounterpartyId(line.plannedCounterpartyId);
          }
          if (line.taxPercent != null) {
            setTaxPercent(Number(line.taxPercent));
          }
          setAmount(Number(line.unitCost) * Number(line.unitsCount));
        }
      }
    });
  }

  function applyCounterpartyDefaults(cpId: string) {
    startSuggest(async () => {
      const res = await suggestAccrualDefaultsAction(projectId, {
        counterpartyId: cpId,
      });
      if ("budgetLineId" in res && res.budgetLineId) {
        setBudgetLineId(res.budgetLineId);
        applyLineDefaults(res.budgetLineId);
      }
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="type">Тип</Label>
        <Select
          id="type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as AccrualType)}
        >
          {(Object.keys(accrualTypeLabels) as AccrualType[]).map((t) => (
            <option key={t} value={t}>
              {accrualTypeLabels[t]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="date">Дата</Label>
        <Input
          id="date"
          name="date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="budgetLineId">Статья *</Label>
        <Select
          id="budgetLineId"
          name="budgetLineId"
          required
          value={budgetLineId}
          onChange={(e) => {
            const id = e.target.value;
            setBudgetLineId(id);
            if (id) applyLineDefaults(id);
          }}
        >
          <option value="">— выберите —</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="counterpartyId">
          Контрагент *{pendingSuggest ? " …" : ""}
        </Label>
        <Select
          id="counterpartyId"
          name="counterpartyId"
          required
          value={counterpartyId}
          onChange={(e) => {
            const id = e.target.value;
            setCounterpartyId(id);
            if (id && !budgetLineId) applyCounterpartyDefaults(id);
          }}
        >
          <option value="">— выберите —</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
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
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </div>
      <div>
        <Label htmlFor="quantity">Количество</Label>
        <Input
          id="quantity"
          name="quantity"
          type="number"
          min={0}
          step="0.01"
          value={quantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
        />
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
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
        />
      </div>
      <div>
        <Label>Сумма с налогом</Label>
        <div className="glass-input flex h-10 items-center rounded-xl px-3 text-sm">
          {withTax.toLocaleString("ru-RU")}
        </div>
      </div>
      {type === AccrualType.PER_SHIFT ? (
        <div className="sm:col-span-2">
          <Label htmlFor="shootDayId">Съёмочный день</Label>
          <Select
            id="shootDayId"
            name="shootDayId"
            value={shootDayId}
            onChange={(e) => {
              const id = e.target.value;
              setShootDayId(id);
              const day = shootDays.find((d) => d.id === id);
              if (day) setDate(toDateInput(day.date));
            }}
          >
            <option value="">— не привязан —</option>
            {shootDays.map((d) => (
              <option key={d.id} value={d.id}>
                День {d.dayNumber} · {formatDateShort(d.date)}
                {d.unit && d.unit !== "main" ? ` · ${d.unit}` : ""}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="shootDayId" value="" />
      )}
      {groupUnits.length > 1 ? (
        <div>
          <Label htmlFor="groupUnit">Съёмочная группа</Label>
          <Select
            id="groupUnit"
            name="groupUnit"
            defaultValue={accrual?.groupUnit ?? ""}
          >
            <option value="">—</option>
            {groupUnits.map((u) => (
              <option key={u} value={u}>
                {u === "main" ? "Основная" : u}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <input type="hidden" name="groupUnit" value={groupUnits[0] ?? "main"} />
      )}
      <div className="sm:col-span-2">
        <Label htmlFor="comment">Примечание</Label>
        <Input
          id="comment"
          name="comment"
          defaultValue={accrual?.comment ?? ""}
        />
      </div>
    </div>
  );
}

function AccrualModal({
  projectId,
  accrual,
  lines,
  counterparties,
  shootDays,
  groupUnits,
  open,
  onClose,
  defaultType,
  defaultBudgetLineId,
  defaultDate,
}: {
  projectId: string;
  accrual?: AccrualListRow;
  lines: LineOpt[];
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  groupUnits: string[];
  open: boolean;
  onClose: () => void;
  defaultType?: AccrualType;
  defaultBudgetLineId?: string;
  defaultDate?: string;
}) {
  const bound = accrual
    ? updateAccrualAction.bind(null, projectId, accrual.id)
    : createAccrualAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        accrual
          ? "Редактирование начисления"
          : defaultType === AccrualType.PER_SHIFT
            ? "Начисление за смену"
            : "Новое начисление"
      }
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="accrual-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="accrual-form" action={action} key={accrual?.id ?? "new"}>
        <AccrualFormFields
          projectId={projectId}
          accrual={accrual}
          lines={lines}
          counterparties={counterparties}
          shootDays={shootDays}
          groupUnits={groupUnits}
          defaultType={defaultType}
          defaultBudgetLineId={defaultBudgetLineId}
          defaultDate={defaultDate}
        />
      </form>
    </Modal>
  );
}

export function AccrualsWorkspace({
  projectId,
  currency,
  accruals,
  lines,
  counterparties,
  shootDays,
  groupUnits,
  filters,
  totals,
  canWrite,
  initialCreate,
  initialBudgetLineId,
}: {
  projectId: string;
  currency: string;
  accruals: AccrualListRow[];
  lines: LineOpt[];
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  groupUnits: string[];
  filters: {
    q: string;
    dateFrom: string;
    dateTo: string;
    budgetLineId: string;
    counterpartyId: string;
    groupUnit: string;
  };
  totals: { count: number; amount: number; withTax: number };
  canWrite: boolean;
  initialCreate?: "PER_SHIFT" | "ONE_TIME" | null;
  initialBudgetLineId?: string;
}) {
  const [creating, setCreating] = useState<AccrualType | null>(
    initialCreate === "PER_SHIFT"
      ? AccrualType.PER_SHIFT
      : initialCreate === "ONE_TIME"
        ? AccrualType.ONE_TIME
        : null,
  );
  const [editing, setEditing] = useState<AccrualListRow | null>(null);

  const lineMap = useMemo(
    () => new Map(lines.map((l) => [l.id, l.title])),
    [lines],
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Начислений
          </div>
          <div className="mt-1 text-xl font-semibold">{totals.count}</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            Сумма
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(totals.amount, currency)}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4">
          <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
            С налогом
          </div>
          <div className="mt-1 text-xl font-semibold">
            {money(totals.withTax, currency)}
          </div>
        </div>
      </div>

      <form
        method="get"
        className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="sm:col-span-2 lg:col-span-3">
          <Label htmlFor="q">Поиск</Label>
          <Input
            id="q"
            name="q"
            defaultValue={filters.q}
            placeholder="Статья, контрагент, примечание…"
          />
        </div>
        <div>
          <Label htmlFor="dateFrom">Дата с</Label>
          <Input
            id="dateFrom"
            name="dateFrom"
            type="date"
            defaultValue={filters.dateFrom}
          />
        </div>
        <div>
          <Label htmlFor="dateTo">Дата по</Label>
          <Input
            id="dateTo"
            name="dateTo"
            type="date"
            defaultValue={filters.dateTo}
          />
        </div>
        <div>
          <Label htmlFor="budgetLineId">Статья</Label>
          <Select
            id="budgetLineId"
            name="budgetLineId"
            defaultValue={filters.budgetLineId}
          >
            <option value="">Все</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="counterpartyId">Контрагент</Label>
          <Select
            id="counterpartyId"
            name="counterpartyId"
            defaultValue={filters.counterpartyId}
          >
            <option value="">Все</option>
            {counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {groupUnits.length > 1 ? (
          <div>
            <Label htmlFor="groupUnit">Группа</Label>
            <Select
              id="groupUnit"
              name="groupUnit"
              defaultValue={filters.groupUnit}
            >
              <option value="">Все</option>
              {groupUnits.map((u) => (
                <option key={u} value={u}>
                  {u === "main" ? "Основная" : u}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit">Применить</Button>
        </div>
      </form>

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => setCreating(AccrualType.PER_SHIFT)}
          >
            Начисление за смену
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCreating(AccrualType.ONE_TIME)}
          >
            + Разовое начисление
          </Button>
        </div>
      ) : null}

      {accruals.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Начислений пока нет. Это фактические расходы проекта (метод
          начисления), независимо от оплаты.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Дата</th>
                <th className="px-4 py-3">Статья</th>
                <th className="px-4 py-3">Контрагент</th>
                <th className="px-4 py-3">Тип</th>
                <th className="px-4 py-3">Сумма</th>
                <th className="px-4 py-3">С налогом</th>
                {canWrite ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {accruals.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatDateShort(a.date)}
                    {a.groupUnit && a.groupUnit !== "main" ? (
                      <div className="text-[11px] text-[var(--muted-fg)]">
                        {a.groupUnit}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {a.budgetLine?.title ?? lineMap.get(a.budgetLineId)}
                    </div>
                    {a.comment ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        {a.comment}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{a.counterparty?.name}</td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">
                    {accrualTypeLabels[a.type]}
                  </td>
                  <td className="px-4 py-3">
                    {money(Number(a.amount), currency)}
                  </td>
                  <td className="px-4 py-3">
                    {money(Number(a.amountWithTax), currency)}
                  </td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditing(a)}
                        >
                          Изменить
                        </Button>
                        <form
                          action={async () => {
                            await deleteAccrualAction(projectId, a.id);
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

      <AccrualModal
        projectId={projectId}
        lines={lines}
        counterparties={counterparties}
        shootDays={shootDays}
        groupUnits={groupUnits}
        open={creating != null}
        defaultType={creating ?? undefined}
        defaultBudgetLineId={initialBudgetLineId}
        onClose={() => setCreating(null)}
      />
      <AccrualModal
        projectId={projectId}
        accrual={editing ?? undefined}
        lines={lines}
        counterparties={counterparties}
        shootDays={shootDays}
        groupUnits={groupUnits}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

export { AccrualModal };
