"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveProductionWorkExtrasAction,
  updateProductionWorkRowAction,
} from "@/features/reports/actions";
import {
  formatMoney,
  formatOvertimeCell,
} from "@/features/reports/lib/compute-work-pay";
import { productionWorkKindLabels } from "@/features/reports/schemas";
import type { ProductionReportWorkRow } from "@/features/reports/types";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Modal } from "@/shared/ui/modal";
import { useToast } from "@/shared/ui/toast";
import { cn } from "@/shared/lib/cn";

type ExtraDraft = { amount: string; description: string };

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

function WorkRowEditor({
  row,
  projectId,
  dayId,
  canEdit,
  onOpenExtras,
}: {
  row: ProductionReportWorkRow;
  projectId: string;
  dayId: string;
  canEdit: boolean;
  onOpenExtras: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [factStart, setFactStart] = useState(row.factStart ?? "");
  const [factEnd, setFactEnd] = useState(row.factEnd ?? "");
  const [lunchSkipped, setLunchSkipped] = useState(row.lunchSkipped);

  useEffect(() => {
    setFactStart(row.factStart ?? "");
    setFactEnd(row.factEnd ?? "");
    setLunchSkipped(row.lunchSkipped);
  }, [row.id, row.factStart, row.factEnd, row.lunchSkipped]);

  function persist(next: {
    factStart: string;
    factEnd: string;
    lunchSkipped: boolean;
  }) {
    if (!canEdit) return;
    startTransition(async () => {
      const result = await updateProductionWorkRowAction(projectId, dayId, {
        workRowId: row.id,
        factStart: next.factStart,
        factEnd: next.factEnd,
        lunchSkipped: next.lunchSkipped,
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

  return (
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
          title="Т/О — не было положенного часового обеда"
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
        {row.totalPay != null ? `${formatMoney(row.totalPay)} ₽` : "—"}
      </td>
    </tr>
  );
}

function WorkExtrasModal({
  open,
  onClose,
  row,
  projectId,
  dayId,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  row: ProductionReportWorkRow | null;
  projectId: string;
  dayId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<ExtraDraft[]>([]);

  useEffect(() => {
    if (!row) return;
    setDrafts(
      row.extras.length > 0
        ? row.extras.map((e) => ({
            amount: String(e.amount),
            description: e.description ?? "",
          }))
        : [{ amount: "", description: "" }],
    );
  }, [row]);

  if (!row) return null;

  function save() {
    if (!canEdit || !row) return;
    startTransition(async () => {
      const result = await saveProductionWorkExtrasAction(projectId, dayId, {
        workRowId: row.id,
        extras: drafts.map((d) => ({
          amount: d.amount === "" || d.amount === "-" ? 0 : Number(d.amount),
          description: d.description,
        })),
      });
      if (result.error) toast.error(result.error);
      else {
        if (result.success) toast.success(result.success);
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Доп. выплаты · ${row.displayName}`}
      footer={
        canEdit ? (
          <>
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="button" disabled={pending} onClick={save}>
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        Разовая сумма и комментарий (доплата, штраф — отрицательная сумма,
        компенсация и т.д.).
      </p>
      <div className="space-y-3">
        {drafts.map((d, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <Input
              type="number"
              step="0.01"
              disabled={!canEdit || pending}
              placeholder="Сумма"
              value={d.amount}
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((row, idx) =>
                    idx === i ? { ...row, amount: e.target.value } : row,
                  ),
                )
              }
            />
            <Input
              disabled={!canEdit || pending}
              placeholder="Комментарий"
              value={d.description}
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((row, idx) =>
                    idx === i
                      ? { ...row, description: e.target.value }
                      : row,
                  ),
                )
              }
            />
            {canEdit ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending || drafts.length <= 1}
                onClick={() =>
                  setDrafts((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                ✕
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {canEdit ? (
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          disabled={pending}
          onClick={() =>
            setDrafts((prev) => [...prev, { amount: "", description: "" }])
          }
        >
          + Добавить выплату
        </Button>
      ) : null}
    </Modal>
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

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-5">
      <h3 className="mb-1 font-semibold">
        Фактическое время работы актёров и ресурсов
      </h3>
      <p className="mb-4 text-sm text-[var(--muted-fg)]">
        Т/О — текущий обед (не было часового перерыва). Переработка: факт
        (оплачиваемая). Без точного времени в дальнейшем учитывается только
        базовая смена.
      </p>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Нет актёров и ресурсов в сценах этого дня.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
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
                <th className="py-2 pr-2 font-medium">Доп.</th>
                <th className="py-2 font-medium">Итого</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([title, groupRows]) => (
                <Fragment key={title}>
                  <tr className="border-b border-[var(--border)] bg-white/[0.03]">
                    <td
                      colSpan={8}
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
        row={extrasRow}
        projectId={projectId}
        dayId={dayId}
        canEdit={canEdit}
      />
    </section>
  );
}
