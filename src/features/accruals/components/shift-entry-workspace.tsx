"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShiftAccrualsBatchAction } from "@/features/accruals/actions";
import { computeTaxAmounts } from "@/features/accruals/lib/labels";
import type { ShiftEntryRow } from "@/features/accruals/queries";
import { BudgetItemSelect } from "@/features/smeta/components/budget-item-select";
import type { BudgetItemOption } from "@/features/smeta/lib/budget-item-option";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

type CpOpt = { id: string; name: string };
type DayOpt = {
  id: string;
  date: Date | string;
  dayNumber: number;
  unit: string | null;
};

type RowState = {
  key: string;
  source: ShiftEntryRow;
  budgetItemId: string;
  counterpartyId: string;
  amount: number;
  quantity: number;
  taxPercent: string;
  comment: string;
  include: boolean;
};

const KIND_LABELS: Record<ShiftEntryRow["kind"], string> = {
  actor: "Актёр",
  resource: "Ресурс",
  location: "Объект",
};

function toDateInput(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

function newKey() {
  return `r-${Math.random().toString(36).slice(2, 9)}`;
}

export function ShiftEntryWorkspace({
  locale,
  projectId,
  rows: sourceRows,
  items,
  counterparties,
  shootDays,
  shootDayId,
  canWrite,
}: {
  locale: string;
  projectId: string;
  rows: ShiftEntryRow[];
  items: BudgetItemOption[];
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  shootDayId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const selectedDay = shootDays.find((d) => d.id === shootDayId);
  const [date, setDate] = useState(
    selectedDay ? toDateInput(selectedDay.date) : "",
  );

  const [rows, setRows] = useState<RowState[]>(() =>
    sourceRows.map((r) => ({
      key: newKey(),
      source: r,
      budgetItemId: r.budgetItemId,
      counterpartyId: r.counterpartyId ?? "",
      amount: r.amount,
      quantity: 1,
      taxPercent: r.taxPercent != null ? String(r.taxPercent) : "",
      comment: "",
      include: false,
    })),
  );

  const included = useMemo(() => rows.filter((r) => r.include), [rows]);

  function patchRow(index: number, patch: Partial<RowState>) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, ...patch };
      return next;
    });
  }

  function copyRow(index: number) {
    setRows((prev) => {
      const src = prev[index];
      if (!src) return prev;
      const copy: RowState = { ...src, key: newKey(), include: true };
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  if (shootDays.length === 0 || !shootDayId) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Нет съёмочных дней в КПП — сначала создайте дни в расписании.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="shootDayId">Дата смены</Label>
          <Select
            id="shootDayId"
            value={shootDayId}
            onChange={(e) =>
              router.push(
                `/${locale}/projects/${projectId}/accruals/shift-entry?day=${e.target.value}`,
              )
            }
          >
            {shootDays.map((d) => (
              <option key={d.id} value={d.id}>
                День {d.dayNumber} · {formatDateShort(d.date)}
                {d.unit && d.unit !== "main" ? ` · ${d.unit}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="date">Дата начисления</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Нет актёров, ресурсов и объектов со статьёй сметы по умолчанию (или их статьи — из смет,
          которые вы не видите). Статья по умолчанию задаётся в карточке актёра, ресурса или
          объекта.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-3 py-2">✓</th>
                <th className="px-3 py-2">Кто</th>
                <th className="px-3 py-2">Статья</th>
                <th className="px-3 py-2">Контрагент</th>
                <th className="px-3 py-2">Сумма</th>
                <th className="px-3 py-2">Кол-во</th>
                <th className="px-3 py-2">Налог %</th>
                <th className="px-3 py-2">С налогом</th>
                <th className="px-3 py-2">Примечание</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const tax =
                  row.taxPercent === "" ? null : Number(row.taxPercent);
                const withTax = computeTaxAmounts(
                  row.amount * row.quantity,
                  tax,
                ).amountWithTax;
                return (
                  <tr key={row.key} className="border-b border-[var(--border)]/60">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={row.include}
                        disabled={!canWrite}
                        onChange={(e) => patchRow(index, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 min-w-[12rem]">
                      <div className="font-medium">{row.source.name}</div>
                      <div className="text-xs text-[var(--muted-fg)]">
                        {KIND_LABELS[row.source.kind]}
                        {row.source.hint ? ` · ${row.source.hint}` : ""}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.source.accruedFromReport ? (
                          <Badge className="text-[var(--danger)]">
                            Смена уже начислена из отчёта
                          </Badge>
                        ) : row.source.onDay ? (
                          <Badge>В отчёте дня</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 min-w-[14rem]">
                      <BudgetItemSelect
                        value={row.budgetItemId}
                        disabled={!canWrite}
                        options={items}
                        onChange={(budgetItemId) =>
                          patchRow(index, { budgetItemId, include: true })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 min-w-[10rem]">
                      <Select
                        value={row.counterpartyId}
                        disabled={!canWrite}
                        onChange={(e) =>
                          patchRow(index, { counterpartyId: e.target.value })
                        }
                      >
                        <option value="">—</option>
                        {counterparties.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canWrite}
                        value={row.amount}
                        onChange={(e) =>
                          patchRow(index, { amount: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 w-24">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!canWrite}
                        value={row.quantity}
                        onChange={(e) =>
                          patchRow(index, { quantity: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="px-3 py-2 w-24">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        disabled={!canWrite}
                        value={row.taxPercent}
                        onChange={(e) => patchRow(index, { taxPercent: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[var(--muted-fg)]">
                      {withTax.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        disabled={!canWrite}
                        value={row.comment}
                        onChange={(e) => patchRow(index, { comment: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {canWrite ? (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => copyRow(index)}
                        >
                          Копировать
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canWrite && rows.length > 0 ? (
        <Button
          type="button"
          disabled={pending || included.length === 0 || !date}
          onClick={() => {
            start(async () => {
              const invalid = included.find((r) => !r.counterpartyId);
              if (invalid) {
                toast.error("Укажите контрагента во всех отмеченных строках");
                return;
              }
              const res = await createShiftAccrualsBatchAction(projectId, {
                shootDayId,
                date,
                groupUnit: selectedDay?.unit ?? null,
                rows: included.map((r) => ({
                  budgetItemId: r.budgetItemId || null,
                  counterpartyId: r.counterpartyId,
                  amount: r.amount * r.quantity,
                  quantity: r.quantity,
                  taxPercent:
                    r.taxPercent === "" ? null : Number(r.taxPercent),
                  comment: r.comment || `${r.source.name}`,
                })),
              });
              if (res.error) {
                toast.error(res.error);
                return;
              }
              toast.success(res.success ?? "Сохранено");
              router.push(`/${locale}/projects/${projectId}/accruals`);
              router.refresh();
            });
          }}
        >
          {pending
            ? "…"
            : `Создать начисления (${included.length})`}
        </Button>
      ) : null}
    </div>
  );
}
