"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { UsageLedgerSummaryRow } from "@/features/payroll/queries-usage-ledger";
import { formatPay } from "@/features/payroll/lib/tax-display";
import { cn } from "@/shared/lib/cn";

const KIND_LABELS: Record<UsageLedgerSummaryRow["kind"], string> = {
  ACTOR: "Актёры",
  RESOURCE: "Ресурсы",
  TRANSPORT: "Спецтранспорт",
  LOCATION: "Локации",
};

function BreakdownTooltip({
  row,
  showWithTax,
}: {
  row: UsageLedgerSummaryRow;
  showWithTax: boolean;
}) {
  const b = showWithTax ? row.withTax : row.withoutTax;
  return (
    <div
      className={cn(
        "pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2",
        "rounded-lg border border-[var(--border)] bg-[var(--panel-solid)] p-2 text-xs shadow-lg",
        "opacity-0 transition-opacity group-hover/cell:opacity-100",
      )}
    >
      <p className="mb-1 font-medium text-[var(--muted-fg)]">
        {showWithTax ? "С налогом" : "Без налога"}
      </p>
      <dl className="space-y-0.5 tabular-nums">
        <div className="flex justify-between gap-2">
          <dt>Смена</dt>
          <dd>{formatPay(b.shiftPay)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Переработка</dt>
          <dd>{formatPay(b.overtimePay)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Доп. выплаты</dt>
          <dd>{formatPay(b.extrasPay)}</dd>
        </div>
        {b.mileagePay !== 0 ? (
          <div className="flex justify-between gap-2">
            <dt>Километраж</dt>
            <dd>{formatPay(b.mileagePay)}</dd>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between gap-2 border-t border-[var(--border)] pt-1 font-medium">
          <dt>Итого</dt>
          <dd>{formatPay(b.totalPay)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function UsageLedgerSummary({
  rows,
  currency,
}: {
  rows: UsageLedgerSummaryRow[];
  currency: string;
}) {
  const [showWithTax, setShowWithTax] = useState(true);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.label.toLowerCase().includes(needle) ||
        (r.categoryLabel ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, r) => {
        const b = showWithTax ? r.withTax : r.withoutTax;
        acc.shiftPay += b.shiftPay;
        acc.overtimePay += b.overtimePay;
        acc.extrasPay += b.extrasPay;
        acc.mileagePay += b.mileagePay;
        acc.totalPay += b.totalPay;
        return acc;
      },
      {
        shiftPay: 0,
        overtimePay: 0,
        extrasPay: 0,
        mileagePay: 0,
        totalPay: 0,
      },
    );
  }, [filtered, showWithTax]);

  const groups = useMemo(() => {
    const map = new Map<string, UsageLedgerSummaryRow[]>();
    for (const row of filtered) {
      const title = row.categoryLabel || KIND_LABELS[row.kind];
      const list = map.get(title) ?? [];
      list.push(row);
      map.set(title, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="taxMode"
              checked={showWithTax}
              onChange={() => setShowWithTax(true)}
            />
            С налогом
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="taxMode"
              checked={!showWithTax}
              onChange={() => setShowWithTax(false)}
            />
            Без налога
          </label>
        </div>
        <input
          className="glass-input max-w-xs rounded-lg px-3 py-1.5 text-sm"
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Нет данных по использованию. Заполните факты в производственных
          отчётах.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-3 py-3 font-medium">Позиция</th>
                <th className="px-3 py-3 font-medium">Дней</th>
                <th className="px-3 py-3 font-medium">Смена</th>
                <th className="px-3 py-3 font-medium">Переработка</th>
                <th className="px-3 py-3 font-medium">Доп.</th>
                <th className="px-3 py-3 font-medium">Итого ({currency})</th>
                <th className="px-3 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {groups.map(([title, groupRows]) => (
                <Fragment key={title}>
                  <tr className="border-b border-[var(--border)] bg-white/[0.03]">
                    <td
                      colSpan={7}
                      className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-fg)]"
                    >
                      {title}
                      <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
                        · {groupRows.length}
                      </span>
                    </td>
                  </tr>
                  {groupRows.map((row) => {
                    const b = showWithTax ? row.withTax : row.withoutTax;
                    return (
                      <tr
                        key={row.key}
                        className="border-b border-[var(--border)]/60"
                      >
                        <td className="px-3 py-2.5 font-medium">{row.label}</td>
                        <td className="px-3 py-2.5 tabular-nums text-[var(--muted-fg)]">
                          {row.dayCount}
                        </td>
                        <td className="group/cell relative px-3 py-2.5 tabular-nums">
                          {formatPay(b.shiftPay)}
                          <BreakdownTooltip
                            row={row}
                            showWithTax={showWithTax}
                          />
                        </td>
                        <td className="group/cell relative px-3 py-2.5 tabular-nums">
                          {formatPay(b.overtimePay)}
                          <BreakdownTooltip
                            row={row}
                            showWithTax={showWithTax}
                          />
                        </td>
                        <td className="group/cell relative px-3 py-2.5 tabular-nums">
                          {formatPay(b.extrasPay)}
                          <BreakdownTooltip
                            row={row}
                            showWithTax={showWithTax}
                          />
                        </td>
                        <td className="group/cell relative px-3 py-2.5 tabular-nums font-medium">
                          {formatPay(b.totalPay)}
                          <BreakdownTooltip
                            row={row}
                            showWithTax={showWithTax}
                          />
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {row.detailHref ? (
                            <Link
                              href={row.detailHref}
                              className="text-sm text-[var(--accent)] hover:underline"
                            >
                              Подробнее
                            </Link>
                          ) : (
                            <span className="text-[var(--muted-fg)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              <tr className="bg-white/[0.04] font-semibold">
                <td className="px-3 py-3">Итого</td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3 tabular-nums">
                  {formatPay(totals.shiftPay)}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {formatPay(totals.overtimePay)}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {formatPay(totals.extrasPay)}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  {formatPay(totals.totalPay)}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--muted-fg)]">
        Наведите на ячейку — детализация (смена, переработка, доп. выплаты)
        согласно режиму «с налогом / без налога».
      </p>
    </div>
  );
}
