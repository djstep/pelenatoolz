"use client";

import { useState } from "react";
import {
  DIFF_FIELD_LABELS,
  type BudgetDiff,
  type DiffField,
  type DiffRow,
  type DiffValues,
} from "@/features/smeta/lib/budget-diff";
import { formatRub, formatRubDelta } from "@/features/smeta/lib/money";
import { Checkbox } from "@/shared/ui/checkbox";
import { cn } from "@/shared/lib/cn";

const KIND_LABEL: Record<DiffRow["kind"], string> = {
  added: "Добавлено",
  removed: "Удалено",
  changed: "Изменено",
  same: "Без изменений",
};

const KIND_ROW: Record<DiffRow["kind"], string> = {
  added: "bg-[var(--row-success)]",
  removed: "bg-[var(--row-danger)]",
  changed: "bg-[var(--row-warning)]",
  same: "",
};

function fieldValue(values: DiffValues, field: DiffField): string {
  const v = values[field];
  if (v === null || v === "") return "—";
  if (typeof v === "number") {
    return field === "amount" || field === "tax" || field === "total" || field === "rate"
      ? formatRub(v)
      : v.toLocaleString("ru-RU", { maximumFractionDigits: 4 });
  }
  return v;
}

/** «было → стало» для одного денежного поля. */
function BeforeAfter({ row, field }: { row: DiffRow; field: "amount" | "total" }) {
  const before = row.before?.[field];
  const after = row.after?.[field];
  if (row.kind === "added") return <span>{formatRub(after ?? 0)}</span>;
  if (row.kind === "removed") return <span className="line-through">{formatRub(before ?? 0)}</span>;
  if (before === after || !row.fields.includes(field)) return <span>{formatRub(after ?? 0)}</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--muted-fg)]">{formatRub(before ?? 0)}</span> →{" "}
      <span className="font-medium">{formatRub(after ?? 0)}</span>
    </span>
  );
}

/** Сравнение «последняя утверждённая версия ↔ черновик» по статьям. */
export function BudgetDiffTable({
  diff,
  beforeLabel,
}: {
  diff: BudgetDiff;
  /** «версия 2» или «утверждённых версий нет». */
  beforeLabel: string;
}) {
  const [showSame, setShowSame] = useState(false);
  const rows = showSame ? diff.rows : diff.rows.filter((r) => r.kind !== "same");
  const delta = diff.totalAfter - diff.totalBefore;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span>
          Добавлено: <b>{diff.counts.added}</b>
        </span>
        <span>
          Удалено: <b>{diff.counts.removed}</b>
        </span>
        <span>
          Изменено: <b>{diff.counts.changed}</b>
        </span>
        <span className="text-[var(--muted-fg)]">Без изменений: {diff.counts.same}</span>
        <span className="ml-auto">
          <Checkbox checked={showSame} onChange={(e) => setShowSame(e.currentTarget.checked)}>
            Показать статьи без изменений
          </Checkbox>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          {diff.empty ? `Отличий от ${beforeLabel} нет.` : "Нет строк для показа."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--glass-table-head)] text-left text-xs text-[var(--muted-fg)]">
              <tr>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Наименование</th>
                <th className="px-3 py-2 font-medium">Что</th>
                <th className="px-3 py-2 text-right font-medium">Сумма</th>
                <th className="px-3 py-2 text-right font-medium">Итого</th>
                <th className="px-3 py-2 font-medium">Подробности</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const values = row.after ?? row.before!;
                const otherFields = row.fields.filter(
                  (f) => f !== "amount" && f !== "total" && f !== "name",
                );
                return (
                  <tr
                    key={row.itemId}
                    className={cn("border-t border-[var(--border)]/60 align-top", KIND_ROW[row.kind])}
                  >
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{row.code}</td>
                    <td className="px-3 py-2">
                      {row.fields.includes("name") && row.before && row.after ? (
                        <>
                          <span className="text-[var(--muted-fg)] line-through">
                            {row.before.name || "—"}
                          </span>{" "}
                          → <span className="font-medium">{row.after.name || "—"}</span>
                          <span className="block text-xs text-[var(--muted-fg)]">
                            переименование — код и связи с платежами те же
                          </span>
                        </>
                      ) : (
                        values.name || "—"
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {KIND_LABEL[row.kind]}
                      {row.kind === "removed" ? (
                        <span className="block text-xs text-[var(--muted-fg)]">в архиве</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <BeforeAfter row={row} field="amount" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <BeforeAfter row={row} field="total" />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {otherFields.map((f) => (
                        <span key={f} className="block">
                          {DIFF_FIELD_LABELS[f]}: {fieldValue(row.before!, f)} →{" "}
                          {fieldValue(row.after!, f)}
                        </span>
                      ))}
                      {row.codeChangePair ? (
                        <span className="block text-[var(--muted-fg)]">
                          {row.kind === "removed"
                            ? `Похоже на смену кода → ${row.codeChangePair}. Факт по ${row.code} останется на старой статье.`
                            : `Похоже на смену кода: было ${row.codeChangePair}.`}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-baseline justify-end gap-3 text-sm">
        <span className="text-[var(--muted-fg)]">Итог по цеху:</span>
        <span className="text-[var(--muted-fg)]">{formatRub(diff.totalBefore)}</span>
        <span>→</span>
        <span className="font-display text-lg font-semibold">{formatRub(diff.totalAfter)}</span>
        <span
          className={cn(
            "font-medium",
            delta > 0.005
              ? "text-[var(--tone-warning-strong)]"
              : delta < -0.005
                ? "text-[var(--tone-success-strong)]"
                : "text-[var(--muted-fg)]",
          )}
        >
          ({formatRubDelta(delta)})
        </span>
      </div>
    </div>
  );
}
