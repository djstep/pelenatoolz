"use client";

import { useState } from "react";
import Link from "next/link";
import { WorkExtrasModal } from "@/features/reports/components/work-extras-modal";
import {
  formatMoney,
  formatOvertimeCell,
} from "@/features/reports/lib/compute-work-pay";
import type { ProductionReportWorkExtra } from "@/features/reports/types";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { cn } from "@/shared/lib/cn";

export type UsageStatementRow = {
  workRowId: string;
  dayId: string;
  dayNumber: number;
  date: string | Date;
  displayName: string;
  workedMin: number | null;
  factOvertimeMin: number | null;
  payableOvertimeMin: number | null;
  overtimePay: number | null;
  extrasPay: number | null;
  totalPay: number | null;
  taxPercent: number | null;
  hasExtras: boolean;
  extras: ProductionReportWorkExtra[];
};

/** @deprecated use UsageStatementRow */
export type OvertimeHistoryRow = UsageStatementRow;

export function OvertimeHistoryTable({
  locale,
  projectId,
  rows,
  canEdit = false,
  emptyText = "Смен с фактом работы пока нет",
  title,
}: {
  locale: string;
  projectId: string;
  rows: UsageStatementRow[];
  canEdit?: boolean;
  emptyText?: string;
  title?: string;
}) {
  const [extrasRow, setExtrasRow] = useState<UsageStatementRow | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-[var(--muted-fg)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {title ? <h4 className="font-semibold">{title}</h4> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
              <th className="px-2 py-2 font-medium">Дата</th>
              <th className="px-2 py-2 font-medium">День</th>
              <th className="px-2 py-2 font-medium">Отработано</th>
              <th className="px-2 py-2 font-medium">Переработка</th>
              <th className="px-2 py-2 font-medium">Доп. выплаты</th>
              <th className="px-2 py-2 font-medium">Итого</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.workRowId}
                className={cn(
                  "border-b border-[var(--border)]/50",
                  row.hasExtras && "bg-red-500/15",
                )}
              >
                <td className="px-2 py-2">
                  <Link
                    href={`/${locale}/projects/${projectId}/reports/${row.dayId}`}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {formatDateShort(row.date)}
                  </Link>
                </td>
                <td className="px-2 py-2">{row.dayNumber}</td>
                <td className="px-2 py-2 tabular-nums">
                  {row.workedMin != null
                    ? formatMinutesHhMm(row.workedMin) || "—"
                    : "—"}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {formatOvertimeCell(
                    row.factOvertimeMin,
                    row.payableOvertimeMin,
                  )}
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className={cn(
                      "rounded px-1.5 py-0.5 tabular-nums hover:underline",
                      row.hasExtras
                        ? "font-medium text-red-400"
                        : "text-[var(--muted-fg)]",
                    )}
                    title="Дополнительные выплаты"
                    onClick={() => setExtrasRow(row)}
                  >
                    {row.extrasPay != null && Number(row.extrasPay) !== 0
                      ? `${formatMoney(row.extrasPay)} ₽`
                      : "—"}
                  </button>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.totalPay != null ? `${formatMoney(row.totalPay)} ₽` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--muted-fg)]">
        Ведомость по использованию: дни с доп. выплатами выделены красным.
        Клик по ячейке «Доп. выплаты» — форма ввода. Переработка: факт (к
        оплате).
      </p>

      <WorkExtrasModal
        open={Boolean(extrasRow)}
        onClose={() => setExtrasRow(null)}
        displayName={extrasRow?.displayName ?? ""}
        workRowId={extrasRow?.workRowId ?? ""}
        projectId={projectId}
        dayId={extrasRow?.dayId ?? ""}
        canEdit={canEdit}
        defaultTaxPercent={
          extrasRow?.taxPercent != null ? Number(extrasRow.taxPercent) : 0
        }
        extras={extrasRow?.extras ?? []}
      />
    </div>
  );
}
