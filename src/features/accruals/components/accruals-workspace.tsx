"use client";

import { useActionState, useState } from "react";
import { AccrualType } from "@prisma/client";
import {
  createAccrualAction,
  deleteAccrualAction,
  updateAccrualAction,
  type AccrualActionState,
} from "@/features/accruals/actions";
import {
  accrualReportPartLabels,
  accrualTypeLabels,
  computeTaxAmounts,
} from "@/features/accruals/lib/labels";
import type { AccrualListRow } from "@/features/accruals/queries";
import { BudgetItemSelect } from "@/features/smeta/components/budget-item-select";
import {
  budgetItemLabel,
  type BudgetItemOption,
} from "@/features/smeta/lib/budget-item-option";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { Select } from "@/shared/ui/select";
import { useActionToast } from "@/shared/ui/toast";
import { formatDateShort } from "@/shared/i18n/format-date";

const initial: AccrualActionState = {};

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

/** Начисление из отчёта смены: сумма, дата и день — из отчёта; руками только статья и контрагент. */
function ReportAccrualFields({
  accrual,
  items,
  itemLabels,
  counterparties,
  currency,
}: {
  accrual: AccrualListRow;
  items: BudgetItemOption[];
  itemLabels: Record<string, BudgetItemOption>;
  counterparties: CpOpt[];
  currency: string;
}) {
  const [budgetItemId, setBudgetItemId] = useState(accrual.budgetItemId ?? "");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-[var(--border)] p-3 text-sm sm:col-span-2">
        <div className="font-medium">
          Из отчёта смены
          {accrual.reportPart ? ` · ${accrualReportPartLabels[accrual.reportPart]}` : ""}
          {accrual.shootDay ? ` · день ${accrual.shootDay.dayNumber}` : ""}
          {" · "}
          {formatDateShort(accrual.date)}
        </div>
        <div className="mt-1 text-[var(--muted-fg)]">
          {money(Number(accrual.amount), currency)} без налога ·{" "}
          {money(Number(accrual.amountWithTax), currency)} с налогом
        </div>
        <div className="mt-1 text-xs text-[var(--muted-fg)]">
          Сумма, дата и день меняются только в отчёте. Статья и контрагент, выбранные здесь,
          отчёт больше не перезаписывает.
        </div>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="budgetItemId">Статья сметы</Label>
        <BudgetItemSelect
          id="budgetItemId"
          name="budgetItemId"
          value={budgetItemId}
          onChange={setBudgetItemId}
          options={items}
          current={accrual.budgetItemId ? itemLabels[accrual.budgetItemId] : null}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="counterpartyId">Контрагент</Label>
        <Select
          id="counterpartyId"
          name="counterpartyId"
          defaultValue={accrual.counterpartyId ?? ""}
        >
          <option value="">— не указан —</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="comment">Примечание</Label>
        <Input id="comment" name="comment" defaultValue={accrual.comment ?? ""} />
      </div>
    </div>
  );
}

function AccrualFormFields({
  accrual,
  items,
  itemLabels,
  counterparties,
  shootDays,
  groupUnits,
  defaultType,
  defaultDate,
}: {
  accrual?: AccrualListRow;
  items: BudgetItemOption[];
  itemLabels: Record<string, BudgetItemOption>;
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  groupUnits: string[];
  defaultType?: AccrualType;
  defaultDate?: string;
}) {
  const [type, setType] = useState<AccrualType>(
    accrual?.type ?? defaultType ?? AccrualType.ONE_TIME,
  );
  const [budgetItemId, setBudgetItemId] = useState(accrual?.budgetItemId ?? "");
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

  const taxNum =
    taxPercent === "" ? null : Number(taxPercent);
  const withTax = computeTaxAmounts(amount, taxNum).amountWithTax;

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
        <Label htmlFor="budgetItemId">Статья сметы</Label>
        <BudgetItemSelect
          id="budgetItemId"
          name="budgetItemId"
          value={budgetItemId}
          onChange={setBudgetItemId}
          options={items}
          current={accrual?.budgetItemId ? itemLabels[accrual.budgetItemId] : null}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="counterpartyId">Контрагент *</Label>
        <Select
          id="counterpartyId"
          name="counterpartyId"
          required
          defaultValue={accrual?.counterpartyId ?? ""}
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
  currency,
  accrual,
  items,
  itemLabels,
  counterparties,
  shootDays,
  groupUnits,
  open,
  onClose,
  defaultType,
  defaultDate,
}: {
  projectId: string;
  currency: string;
  accrual?: AccrualListRow;
  items: BudgetItemOption[];
  itemLabels: Record<string, BudgetItemOption>;
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  groupUnits: string[];
  open: boolean;
  onClose: () => void;
  defaultType?: AccrualType;
  defaultDate?: string;
}) {
  const bound = accrual
    ? updateAccrualAction.bind(null, projectId, accrual.id)
    : createAccrualAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useActionSuccess(state, onClose);

  return (
    <Modal
      guardUnsaved
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
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={onClose}
          >
            Отмена
          </Button>
        </div>
      }
    >
      <form id="accrual-form" action={action} key={accrual?.id ?? "new"}>
        {accrual?.reportPart ? (
          <ReportAccrualFields
            accrual={accrual}
            items={items}
            itemLabels={itemLabels}
            counterparties={counterparties}
            currency={currency}
          />
        ) : (
          <AccrualFormFields
            accrual={accrual}
            items={items}
            itemLabels={itemLabels}
            counterparties={counterparties}
            shootDays={shootDays}
            groupUnits={groupUnits}
            defaultType={defaultType}
            defaultDate={defaultDate}
          />
        )}
      </form>
    </Modal>
  );
}

/** Пометки начисления: «из отчёта смены», «обнулено в отчёте», «контрагент не указан». */
function AccrualMarks({ accrual }: { accrual: AccrualListRow }) {
  if (!accrual.reportPart && accrual.counterpartyId) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {accrual.reportPart ? (
        <Badge>Отчёт смены · {accrualReportPartLabels[accrual.reportPart]}</Badge>
      ) : null}
      {accrual.reportZeroedAt ? (
        <Badge className="text-[var(--danger)]">Обнулено в отчёте</Badge>
      ) : null}
      {!accrual.counterpartyId ? (
        <Badge className="text-[var(--danger)]">Контрагент не указан</Badge>
      ) : null}
    </div>
  );
}

export function AccrualsWorkspace({
  projectId,
  currency,
  accruals,
  items,
  itemLabels,
  counterparties,
  shootDays,
  groupUnits,
  filters,
  totals,
  canWrite,
  initialCreate,
}: {
  projectId: string;
  currency: string;
  accruals: AccrualListRow[];
  items: BudgetItemOption[];
  itemLabels: Record<string, BudgetItemOption>;
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  groupUnits: string[];
  filters: {
    q: string;
    dateFrom: string;
    dateTo: string;
    budgetItemId: string;
    counterpartyId: string;
    groupUnit: string;
  };
  totals: { count: number; amount: number; withTax: number };
  canWrite: boolean;
  initialCreate?: "PER_SHIFT" | "ONE_TIME" | null;
}) {
  const [creating, setCreating] = useState<AccrualType | null>(
    initialCreate === "PER_SHIFT"
      ? AccrualType.PER_SHIFT
      : initialCreate === "ONE_TIME"
        ? AccrualType.ONE_TIME
        : null,
  );
  const [editing, setEditing] = useState<AccrualListRow | null>(null);
  const confirmDelete = useConfirm();

  const itemLabel = (id: string | null) =>
    budgetItemLabel(id ? itemLabels[id] : null);
  // В фильтре — видимые статьи и выбранная, даже если её нет среди видимых.
  const filterItem =
    filters.budgetItemId && filters.budgetItemId !== "none"
      ? itemLabels[filters.budgetItemId]
      : undefined;
  const filterOptions =
    filterItem && !items.some((i) => i.id === filterItem.id)
      ? [filterItem, ...items]
      : items;

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
            placeholder="Код или наименование статьи, контрагент, примечание…"
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
          <Label htmlFor="budgetItemId">Статья</Label>
          <Select
            id="budgetItemId"
            name="budgetItemId"
            defaultValue={filters.budgetItemId}
          >
            <option value="">Все</option>
            <option value="none">Без статьи</option>
            {filterOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {budgetItemLabel(i)}
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
                    <div
                      className={
                        a.budgetItemId ? "font-medium" : "text-[var(--muted-fg)]"
                      }
                    >
                      {itemLabel(a.budgetItemId)}
                    </div>
                    {a.comment ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        {a.comment}
                      </div>
                    ) : null}
                    <AccrualMarks accrual={a} />
                  </td>
                  <td className="px-4 py-3">{a.counterparty?.name ?? "—"}</td>
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
                        <Button
                          type="button"
                          variant="danger"
                          aria-label="Удалить начисление"
                          onClick={() =>
                            void confirmDelete({
                              title: `Удалить начисление „${itemLabel(a.budgetItemId)}“ от ${formatDateShort(a.date)}, ${money(Number(a.amountWithTax), currency)}?`,
                              action: () => deleteAccrualAction(projectId, a.id),
                            })
                          }
                        >
                          ×
                        </Button>
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
        currency={currency}
        items={items}
        itemLabels={itemLabels}
        counterparties={counterparties}
        shootDays={shootDays}
        groupUnits={groupUnits}
        open={creating != null}
        defaultType={creating ?? undefined}
        onClose={() => setCreating(null)}
      />
      <AccrualModal
        projectId={projectId}
        currency={currency}
        accrual={editing ?? undefined}
        items={items}
        itemLabels={itemLabels}
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
