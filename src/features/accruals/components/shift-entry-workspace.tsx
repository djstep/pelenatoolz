"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createShiftAccrualsBatchAction,
  suggestAccrualDefaultsAction,
} from "@/features/accruals/actions";
import { computeTaxAmounts } from "@/features/accruals/lib/labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select } from "@/shared/ui/select";
import { useToast } from "@/shared/ui/toast";

type Line = {
  id: string;
  title: string;
  unitCost: { toString(): string } | number;
  unitsCount: { toString(): string } | number;
  taxPercent: { toString(): string } | number | null;
  plannedCounterpartyId: string | null;
  linkedResourceType: string | null;
  linkedResourceId: string | null;
  plannedCounterparty?: { id: string; name: string } | null;
};

type CpOpt = { id: string; name: string };
type DayOpt = {
  id: string;
  date: Date | string;
  dayNumber: number;
  unit: string | null;
};

type RowState = {
  key: string;
  budgetLineId: string;
  counterpartyId: string;
  amount: number;
  quantity: number;
  taxPercent: string;
  comment: string;
  include: boolean;
};

function toDateInput(d: Date | string) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toISOString().slice(0, 10);
}

function newKey() {
  return `r-${Math.random().toString(36).slice(2, 9)}`;
}

export function ShiftEntryWorkspace({
  projectId,
  lines,
  counterparties,
  shootDays,
  canWrite,
}: {
  projectId: string;
  lines: Line[];
  counterparties: CpOpt[];
  shootDays: DayOpt[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [shootDayId, setShootDayId] = useState(shootDays[0]?.id ?? "");
  const selectedDay = shootDays.find((d) => d.id === shootDayId);
  const [date, setDate] = useState(
    selectedDay ? toDateInput(selectedDay.date) : "",
  );

  const [rows, setRows] = useState<RowState[]>(() =>
    lines.map((l) => ({
      key: newKey(),
      budgetLineId: l.id,
      counterpartyId: l.plannedCounterpartyId ?? "",
      amount: Number(l.unitCost) * Number(l.unitsCount),
      quantity: 1,
      taxPercent: l.taxPercent != null ? String(Number(l.taxPercent)) : "",
      comment: "",
      include: false,
    })),
  );

  const included = useMemo(() => rows.filter((r) => r.include), [rows]);

  async function fillDefaultsForRow(index: number, lineId: string) {
    const res = await suggestAccrualDefaultsAction(projectId, {
      budgetLineId: lineId,
      shootDayId: shootDayId || null,
    });
    setRows((prev) => {
      const next = [...prev];
      const row = { ...next[index]! };
      if ("defaults" in res && res.defaults) {
        const d = res.defaults;
        if (d.counterpartyId) row.counterpartyId = d.counterpartyId;
        if (d.taxPercent != null) row.taxPercent = String(d.taxPercent);
        if (d.amount != null) row.amount = d.amount;
        if (d.quantity != null) row.quantity = d.quantity;
      }
      next[index] = row;
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

  if (shootDays.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Нет съёмочных дней в КПП — сначала создайте дни в расписании.
      </p>
    );
  }

  if (lines.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-fg)]">
        Нет статей с привязкой к ресурсу/актёру или типом «Посменная». Укажите
        связь в «Статьи».
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
            onChange={(e) => {
              const id = e.target.value;
              setShootDayId(id);
              const day = shootDays.find((d) => d.id === id);
              if (day) setDate(toDateInput(day.date));
              // refresh defaults for all rows
              start(async () => {
                for (let i = 0; i < lines.length; i++) {
                  await fillDefaultsForRow(i, lines[i]!.id);
                }
              });
            }}
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

      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
              <th className="px-3 py-2">✓</th>
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
              const withTax = computeTaxAmounts(row.amount, tax).amountWithTax;
              return (
                <tr key={row.key} className="border-b border-[var(--border)]/60">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={!canWrite}
                      onChange={(e) => {
                        const include = e.target.checked;
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index]!, include };
                          return next;
                        });
                        if (include) {
                          void fillDefaultsForRow(index, row.budgetLineId);
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      value={row.budgetLineId}
                      disabled={!canWrite}
                      onChange={(e) => {
                        const id = e.target.value;
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = {
                            ...next[index]!,
                            budgetLineId: id,
                            include: true,
                          };
                          return next;
                        });
                        void fillDefaultsForRow(index, id);
                      }}
                    >
                      {lines.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2 min-w-[10rem]">
                    <Select
                      value={row.counterpartyId}
                      disabled={!canWrite}
                      onChange={(e) => {
                        const cpId = e.target.value;
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = {
                            ...next[index]!,
                            counterpartyId: cpId,
                          };
                          return next;
                        });
                        if (cpId) {
                          start(async () => {
                            const res = await suggestAccrualDefaultsAction(
                              projectId,
                              { counterpartyId: cpId },
                            );
                            if ("budgetLineId" in res && res.budgetLineId) {
                              setRows((prev) => {
                                const next = [...prev];
                                next[index] = {
                                  ...next[index]!,
                                  budgetLineId: res.budgetLineId!,
                                };
                                return next;
                              });
                            }
                          });
                        }
                      }}
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
                      onChange={(e) => {
                        const amount = Number(e.target.value);
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index]!, amount };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 w-24">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      disabled={!canWrite}
                      value={row.quantity}
                      onChange={(e) => {
                        const quantity = Number(e.target.value);
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index]!, quantity };
                          return next;
                        });
                      }}
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
                      onChange={(e) => {
                        const taxPercent = e.target.value;
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index]!, taxPercent };
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--muted-fg)]">
                    {withTax.toLocaleString("ru-RU")}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      disabled={!canWrite}
                      value={row.comment}
                      onChange={(e) => {
                        const comment = e.target.value;
                        setRows((prev) => {
                          const next = [...prev];
                          next[index] = { ...next[index]!, comment };
                          return next;
                        });
                      }}
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

      {canWrite ? (
        <Button
          type="button"
          disabled={pending || included.length === 0 || !shootDayId || !date}
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
                  budgetLineId: r.budgetLineId,
                  counterpartyId: r.counterpartyId,
                  amount: r.amount,
                  quantity: r.quantity,
                  taxPercent:
                    r.taxPercent === "" ? null : Number(r.taxPercent),
                  comment: r.comment || null,
                })),
              });
              if (res.error) {
                toast.error(res.error);
                return;
              }
              toast.success(res.success ?? "Сохранено");
              router.push(`/ru/projects/${projectId}/accruals`);
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
