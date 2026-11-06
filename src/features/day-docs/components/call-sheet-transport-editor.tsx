"use client";

import { useRef, useState } from "react";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import {
  saveCallSheetTransportsAction,
  type TransportSaveState,
} from "@/features/day-docs/transport-actions";
import {
  editorRowsPayload,
  type TransportEditorRow,
} from "@/features/day-docs/lib/transport-rules";
import type { CallSheetTransportEditorData } from "@/features/day-docs/transport-queries";
import { BudgetItemSelect } from "@/features/smeta/components/budget-item-select";
import { useRevisionAction } from "@/features/call-sheets/components/revision-context";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

type Row = TransportEditorRow & { key: string };

const initial: TransportSaveState = {};

function withKeys(rows: TransportEditorRow[]): Row[] {
  return rows.map((row) => ({ ...row, key: row.id }));
}

function move<T>(rows: T[], from: number, to: number): T[] {
  if (to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Спецтранспорт дня в вызывном: название, подача, конец, сцены, ставка км, статья сметы,
 * примечание; порядок — стрелками. Сохраняется по id строк (строки отчёта смены и км
 * не теряются). Статью и ставку км меняет только тот, у кого «Финансы: правка».
 */
export function CallSheetTransportEditor({
  projectId,
  dayId,
  data,
}: {
  projectId: string;
  dayId: string;
  data: CallSheetTransportEditorData;
}) {
  const bound = saveCallSheetTransportsAction.bind(null, projectId, dayId);
  const [state, action, pending] = useSafeActionState(useRevisionAction(bound), initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(true, undefined, state);
  useActionSuccess(state, markClean);

  const [rows, setRows] = useState<Row[]>(() => withKeys(data.rows));
  // После сохранения — строки с сервера: у новых строк появляются id.
  const [appliedState, setAppliedState] = useState(state);
  if (state !== appliedState) {
    setAppliedState(state);
    if (state.rows) setRows(withKeys(state.rows));
  }

  const nextKey = useRef(0);
  const { canEditFinance, canSeeKmRate } = data;

  function patch(key: string, change: Partial<TransportEditorRow>) {
    setRows((list) => list.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function addRow() {
    const key = `n${nextKey.current++}`;
    setRows((list) => [
      ...list,
      {
        key,
        id: "",
        name: "",
        callTime: "",
        wrapTime: "",
        scenes: "",
        notes: "",
        kmRate: "",
        budgetItemId: "",
      },
    ]);
  }

  return (
    <form ref={ref} onSubmit={submitKeepingFields(action)} className="space-y-3">
      <input type="hidden" name="payload" value={editorRowsPayload(rows, canEditFinance)} />

      <div>
        <h4 className="sheet-subhead">Спецтранспорт</h4>
        <p className="mt-0.5 text-xs text-[var(--muted-fg)]">
          Статья сметы попадает в отчёт смены, когда там создаётся строка этой техники; у уже
          созданных строк отчёта и начислений статья не меняется.
          {canEditFinance
            ? null
            : " Статью и ставку за км меняет тот, у кого есть право «Финансы: правка»."}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Спецтранспорта пока нет.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <div
                key={row.key}
                className="flex flex-wrap items-start gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2.5 text-sm"
              >
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_5.5rem_5.5rem_1fr_6.5rem_1.6fr]">
                  <Input
                    aria-label={`Название, строка ${n}`}
                    placeholder="Техника *"
                    required
                    maxLength={200}
                    value={row.name}
                    onChange={(e) => patch(row.key, { name: e.target.value })}
                  />
                  <HhMmInput
                    aria-label={`Подача, строка ${n}`}
                    title="Подача"
                    placeholder="Подача"
                    value={row.callTime}
                    onChange={(value) => patch(row.key, { callTime: value })}
                  />
                  <HhMmInput
                    aria-label={`Конец, строка ${n}`}
                    title="Конец работы"
                    placeholder="Конец"
                    value={row.wrapTime}
                    onChange={(value) => patch(row.key, { wrapTime: value })}
                  />
                  <Input
                    aria-label={`Сцены, строка ${n}`}
                    placeholder="Сцены"
                    maxLength={200}
                    value={row.scenes}
                    onChange={(e) => patch(row.key, { scenes: e.target.value })}
                  />
                  {canSeeKmRate ? (
                    <Input
                      aria-label={`Ставка за км, строка ${n}`}
                      title={
                        canEditFinance
                          ? "Ставка за километр"
                          : "Ставку за км меняет тот, у кого есть право «Финансы: правка»"
                      }
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="₽/км"
                      disabled={!canEditFinance}
                      value={row.kmRate}
                      onChange={(e) => patch(row.key, { kmRate: e.target.value })}
                    />
                  ) : (
                    <span className="hidden lg:block" />
                  )}
                  <BudgetItemSelect
                    value={row.budgetItemId}
                    onChange={(id) => patch(row.key, { budgetItemId: id })}
                    options={data.budgetItems}
                    current={
                      row.budgetItemId ? data.currentBudgetItems[row.budgetItemId] : null
                    }
                    disabled={!canEditFinance}
                  />
                  <Input
                    aria-label={`Примечание, строка ${n}`}
                    placeholder="Примечание"
                    maxLength={500}
                    className="sm:col-span-2 lg:col-span-6"
                    value={row.notes}
                    onChange={(e) => patch(row.key, { notes: e.target.value })}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Поднять строку ${n}`}
                    title="Выше"
                    disabled={index === 0}
                    onClick={() => setRows((list) => move(list, index, index - 1))}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Опустить строку ${n}`}
                    title="Ниже"
                    disabled={index === rows.length - 1}
                    onClick={() => setRows((list) => move(list, index, index + 1))}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Убрать строку ${n}`}
                    title="Убрать"
                    onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                  >
                    ✕
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={addRow}>
          + Техника
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Сохранить спецтранспорт"}
        </Button>
      </div>
    </form>
  );
}
