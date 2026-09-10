"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProductionWorkRowAction } from "@/features/reports/actions";
import { WorkExtrasModal } from "@/features/reports/components/work-extras-modal";
import {
  computeMileagePay,
  formatMoney,
  formatOvertimeCell,
} from "@/features/reports/lib/compute-work-pay";
import { productionWorkKindLabels } from "@/features/reports/schemas";
import type { ProductionReportWorkRow } from "@/features/reports/types";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { Checkbox } from "@/shared/ui/checkbox";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

function ExtraPayIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn(
        "h-4 w-4",
        active ? "text-[var(--accent)]" : "text-[var(--muted-fg)] opacity-50",
      )}
    >
      <rect
        x="2.5"
        y="5"
        width="15"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.2 : 0}
      />
      <path
        d="M2.5 8.5h15"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle
        cx="13.5"
        cy="12.5"
        r="1.25"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function showsMileage(row: ProductionReportWorkRow) {
  return row.tracksMileage || row.kind === "TRANSPORT";
}

function WorkRowEditor({
  row,
  projectId,
  dayId,
  canEdit,
  showMileageColumn,
  colCount,
  onOpenExtras,
}: {
  row: ProductionReportWorkRow;
  projectId: string;
  dayId: string;
  canEdit: boolean;
  showMileageColumn: boolean;
  colCount: number;
  onOpenExtras: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [factStart, setFactStart] = useState(row.factStart ?? "");
  const [factEnd, setFactEnd] = useState(row.factEnd ?? "");
  const [lunchSkipped, setLunchSkipped] = useState(row.lunchSkipped);
  const [factKm, setFactKm] = useState(
    row.factKm != null ? String(row.factKm) : "",
  );

  const mileageEnabled = showsMileage(row);

  useEffect(() => {
    setFactStart(row.factStart ?? "");
    setFactEnd(row.factEnd ?? "");
    setLunchSkipped(row.lunchSkipped);
    setFactKm(row.factKm != null ? String(row.factKm) : "");
  }, [row.id, row.factStart, row.factEnd, row.lunchSkipped, row.factKm]);

  function persist(next: {
    factStart: string;
    factEnd: string;
    lunchSkipped: boolean;
    factKm?: string;
  }) {
    if (!canEdit) return;
    const kmRaw = next.factKm ?? factKm;
    const kmParsed =
      mileageEnabled && kmRaw.trim() !== "" ? Number(kmRaw) : null;
    startTransition(async () => {
      const result = await updateProductionWorkRowAction(projectId, dayId, {
        workRowId: row.id,
        factStart: next.factStart,
        factEnd: next.factEnd,
        lunchSkipped: next.lunchSkipped,
        ...(mileageEnabled ? { factKm: kmParsed } : {}),
      });
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  }

  const otLabel = formatOvertimeCell(row.factOvertimeMin, row.payableOvertimeMin);
  const otTitle =
    row.overtimePay != null
      ? `К оплате за переработку: ${formatMoney(row.overtimePay)} ₽`
      : row.shiftRate != null
        ? "Переработка рассчитана; сумма — по ставкам гонорара"
        : "Задайте финансовые условия в карточке актёра/ресурса";

  const hasExtras = row.extras.length > 0;
  const liveKm = factKm.trim() === "" ? null : Number(factKm);
  const liveMileagePay = mileageEnabled
    ? computeMileagePay(
        Number.isFinite(liveKm as number) ? liveKm : row.factKm,
        row.kmRate,
      )
    : 0;
  const workPayWithoutMileage =
    row.totalPay != null
      ? Number(row.totalPay) - Number(row.mileagePay ?? 0)
      : null;

  return (
    <Fragment>
      <tr
        className={cn(
          "border-b border-[var(--border)]/60",
          pending && "opacity-70",
        )}
      >
        <td className="py-2 pr-3 align-middle font-medium">{row.displayName}</td>
        <td className="py-2 pr-2 align-middle">
          <HhMmInput
            value={factStart}
            disabled={!canEdit || pending}
            onChange={(v) => {
              setFactStart(v);
              if ((row.factStart ?? "") !== v) {
                persist({ factStart: v, factEnd, lunchSkipped });
              }
            }}
            placeholder="—"
          />
        </td>
        <td className="py-2 pr-2 align-middle">
          <HhMmInput
            value={factEnd}
            disabled={!canEdit || pending}
            onChange={(v) => {
              setFactEnd(v);
              if ((row.factEnd ?? "") !== v) {
                persist({ factStart, factEnd: v, lunchSkipped });
              }
            }}
            placeholder="—"
          />
        </td>
        <td className="py-2 pr-3 align-middle text-[var(--muted-fg)] tabular-nums">
          {row.workedMin != null ? formatMinutesHhMm(row.workedMin) || "—" : "—"}
        </td>
        <td className="py-2 pr-3 align-middle">
          <Checkbox
            checked={lunchSkipped}
            disabled={!canEdit || pending}
            title="Т/О — текущий обед: +1 час к расчёту стоимости смены"
            aria-label="Т/О"
            onChange={(e) => {
              const next = e.target.checked;
              setLunchSkipped(next);
              persist({ factStart, factEnd, lunchSkipped: next });
            }}
          />
        </td>
        <td
          className="py-2 pr-3 align-middle tabular-nums"
          title={otTitle}
        >
          {otLabel}
        </td>
        {showMileageColumn ? (
          <td className="py-2 pr-2 align-middle">
            {mileageEnabled ? (
              <Input
                type="number"
                min={0}
                step="0.1"
                className="w-[5.5rem]"
                disabled={!canEdit || pending}
                value={factKm}
                placeholder="км"
                title={
                  row.kmRate != null
                    ? `Ставка: ${formatMoney(row.kmRate)} ₽/км`
                    : "Ставка за км не задана"
                }
                onChange={(e) => setFactKm(e.target.value)}
                onBlur={() => {
                  const prev =
                    row.factKm != null ? String(row.factKm) : "";
                  if (factKm !== prev) {
                    persist({ factStart, factEnd, lunchSkipped, factKm });
                  }
                }}
              />
            ) : (
              <span className="text-[var(--muted-fg)]">—</span>
            )}
          </td>
        ) : null}
        <td className="py-2 pr-2 align-middle">
          <button
            type="button"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent",
              "hover:border-[var(--border)] hover:bg-white/5",
              hasExtras && "border-[var(--accent)]/40 bg-[var(--accent)]/10",
            )}
            title={
              hasExtras
                ? `Доп. выплаты: ${formatMoney(row.extrasPay)} ₽`
                : "Дополнительные выплаты"
            }
            onClick={onOpenExtras}
          >
            <ExtraPayIcon active={hasExtras} />
          </button>
        </td>
        <td className="py-2 align-middle tabular-nums text-[var(--muted-fg)]">
          {workPayWithoutMileage != null
            ? `${formatMoney(workPayWithoutMileage)} ₽`
            : "—"}
        </td>
      </tr>
      {mileageEnabled ? (
        <tr className="border-b border-[var(--border)]/40 bg-white/[0.02]">
          <td
            colSpan={colCount - 1}
            className="py-1.5 pl-6 pr-3 text-xs text-[var(--muted-fg)]"
          >
            Километраж
            {row.kmRate != null || liveKm != null ? (
              <span className="ml-2 tabular-nums">
                {(Number.isFinite(liveKm as number) ? liveKm : row.factKm) ?? 0}{" "}
                км × {formatMoney(row.kmRate ?? 0)} ₽/км
              </span>
            ) : (
              <span className="ml-2">ставка × факт. км</span>
            )}
          </td>
          <td className="py-1.5 align-middle tabular-nums text-xs">
            {liveMileagePay !== 0 || row.mileagePay
              ? `${formatMoney(liveMileagePay || Number(row.mileagePay ?? 0))} ₽`
              : "—"}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

const KIND_ORDER: Record<string, number> = {
  ACTOR: 0,
  RESOURCE: 1,
  TRANSPORT: 2,
  LOCATION: 3,
};

function groupWorkRows(rows: ProductionReportWorkRow[]) {
  const groups = new Map<string, ProductionReportWorkRow[]>();
  for (const row of rows) {
    const title =
      row.categoryLabel?.trim() ||
      productionWorkKindLabels[row.kind] ||
      row.kind;
    const list = groups.get(title) ?? [];
    list.push(row);
    groups.set(title, list);
  }

  return [...groups.entries()].sort(([titleA, rowsA], [titleB, rowsB]) => {
    const kindA = KIND_ORDER[rowsA[0]?.kind ?? ""] ?? 99;
    const kindB = KIND_ORDER[rowsB[0]?.kind ?? ""] ?? 99;
    if (kindA !== kindB) return kindA - kindB;
    const orderA = Math.min(...rowsA.map((r) => r.sortOrder));
    const orderB = Math.min(...rowsB.map((r) => r.sortOrder));
    if (orderA !== orderB) return orderA - orderB;
    return titleA.localeCompare(titleB, "ru");
  });
}

export function WorkRowsSection({
  rows,
  projectId,
  dayId,
  canEdit,
}: {
  rows: ProductionReportWorkRow[];
  projectId: string;
  dayId: string;
  canEdit: boolean;
}) {
  const [extrasRowId, setExtrasRowId] = useState<string | null>(null);
  const extrasRow = rows.find((r) => r.id === extrasRowId) ?? null;
  const groups = groupWorkRows(rows);
  const showMileageColumn = rows.some(showsMileage);
  const colCount = showMileageColumn ? 9 : 8;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
      <h3 className="mb-1 font-semibold">
        Фактическое время работы актёров и ресурсов
      </h3>
      <p className="mb-4 text-sm text-[var(--muted-fg)]">
        Т/О — текущий обед: при отметке к расчёту стоимости прибавляется 1 час
        (даже если факт. отработано меньше смены). Переработка:{" "}
        <span className="tabular-nums">01:25 (02:00)</span> — факт / к оплате.
        Иконка «Доп.» — разовые выплаты дня.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Нет актёров и ресурсов в сценах этого дня.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className={cn(
              "w-full text-left text-sm",
              showMileageColumn ? "min-w-[980px]" : "min-w-[900px]",
            )}
          >
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="py-2 pr-3 font-medium">Позиция</th>
                <th className="py-2 pr-2 font-medium">Начало</th>
                <th className="py-2 pr-2 font-medium">Конец</th>
                <th className="py-2 pr-3 font-medium">Отработано</th>
                <th className="py-2 pr-3 font-medium" title="Текущий обед">
                  Т/О
                </th>
                <th className="py-2 pr-3 font-medium">Переработка</th>
                {showMileageColumn ? (
                  <th className="py-2 pr-2 font-medium">Километраж</th>
                ) : null}
                <th className="py-2 pr-2 font-medium">Доп.</th>
                <th className="py-2 font-medium">Итого</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([title, groupRows]) => (
                <Fragment key={title}>
                  <tr className="border-b border-[var(--border)] bg-white/[0.03]">
                    <td
                      colSpan={colCount}
                      className="py-2.5 pr-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted-fg)]"
                    >
                      {title}
                      <span className="ml-2 font-normal normal-case tracking-normal opacity-70">
                        · {groupRows.length}
                      </span>
                    </td>
                  </tr>
                  {groupRows.map((row) => (
                    <WorkRowEditor
                      key={row.id}
                      row={row}
                      projectId={projectId}
                      dayId={dayId}
                      canEdit={canEdit}
                      showMileageColumn={showMileageColumn}
                      colCount={colCount}
                      onOpenExtras={() => setExtrasRowId(row.id)}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WorkExtrasModal
        open={Boolean(extrasRow)}
        onClose={() => setExtrasRowId(null)}
        displayName={extrasRow?.displayName ?? ""}
        workRowId={extrasRow?.id ?? ""}
        projectId={projectId}
        dayId={dayId}
        canEdit={canEdit}
        defaultTaxPercent={
          extrasRow?.taxPercent != null ? Number(extrasRow.taxPercent) : 0
        }
        extras={extrasRow?.extras ?? []}
      />
    </section>
  );
}
