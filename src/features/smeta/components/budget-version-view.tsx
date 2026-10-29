"use client";

import { useState } from "react";
import { SmetaWorkspace } from "@/features/smeta/components/smeta-workspace";
import type { DiffSource } from "@/features/smeta/lib/budget-diff";
import { formatRub } from "@/features/smeta/lib/money";
import type { BudgetClient } from "@/features/smeta/queries";
import { SegmentControl } from "@/shared/ui/segment-control";

function num(v: number | null) {
  return v === null ? "—" : v.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
}

/** Утверждённая версия: строки (как легли в план) или снимок листа — только чтение. */
export function BudgetVersionView({
  projectId,
  department,
  sheetBook,
  lines,
  total,
  title,
  versionsHref,
}: {
  projectId: string;
  department: { id: string; name: string; codePrefix: string };
  sheetBook: BudgetClient;
  lines: DiffSource[];
  total: number;
  title: string;
  versionsHref: string;
}) {
  const [view, setView] = useState<"lines" | "sheet">("lines");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SegmentControl
        name="version-view"
        value={view}
        onChange={setView}
        options={[
          { value: "lines", label: "Статьи" },
          { value: "sheet", label: "Лист" },
        ]}
      />
      {view === "sheet" ? (
        <div className="flex h-[70vh] min-h-[420px] flex-col">
          <SmetaWorkspace
            projectId={projectId}
            department={department}
            budget={sheetBook}
            canWrite={false}
            initialChecks={[]}
            usedCodes={[]}
            listHref={versionsHref}
            mode="version"
            title={title}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-[var(--glass-table-head)] text-left text-xs text-[var(--muted-fg)]">
              <tr>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Наименование</th>
                <th className="px-3 py-2 font-medium">Ед.</th>
                <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                <th className="px-3 py-2 text-right font-medium">Ставка</th>
                <th className="px-3 py-2 text-right font-medium">Дни</th>
                <th className="px-3 py-2 text-right font-medium">Сумма</th>
                <th className="px-3 py-2 text-right font-medium">Налог, %</th>
                <th className="px-3 py-2 text-right font-medium">Налог</th>
                <th className="px-3 py-2 text-right font-medium">Итого</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.itemId} className="border-t border-[var(--border)]/60">
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{l.code}</td>
                  <td className="px-3 py-2">{l.name || "—"}</td>
                  <td className="px-3 py-2">{l.unit ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{num(l.quantity)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {l.rate === null ? "—" : formatRub(l.rate)}
                  </td>
                  <td className="px-3 py-2 text-right">{num(l.days)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatRub(l.amount)}</td>
                  <td className="px-3 py-2 text-right">{num(l.taxPercent)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{formatRub(l.tax)}</td>
                  <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {formatRub(l.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-[var(--border)] font-semibold">
                <td className="px-3 py-2" colSpan={9}>
                  Итого по цеху
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatRub(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
