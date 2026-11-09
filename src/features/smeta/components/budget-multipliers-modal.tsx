"use client";

import { useState } from "react";
import type { DraftSlot } from "@/features/smeta/lib/line-draft";
import { formatNumber } from "@/features/smeta/lib/line-draft";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";

export type VariableOption = { id: string; label: string; value: string | null };

/** «× СМЕНЫ (32) × 0,7» — множители строки текстом; пустые слоты пропускаются. */
export function multipliersText(slots: readonly DraftSlot[], variables: readonly VariableOption[]): string {
  const parts = slots.flatMap((s) => {
    if (s.kind === "variable") {
      const v = variables.find((x) => x.id === s.variableId);
      if (!v) return ["× ?"];
      return [`× ${v.label} (${v.value == null ? "не задана" : formatNumber(v.value)})`];
    }
    if (s.kind === "number" && s.value.trim()) return [`× ${s.value.trim()}`];
    return [];
  });
  return parts.join(" ");
}

/**
 * Окно множителей строки: до трёх, каждый — переменная проекта или своё число.
 * Значения переменных меняют продюсер и финансы в настройках; здесь их только выбирают.
 */
export function BudgetMultipliersModal({
  open,
  slots,
  variables,
  onClose,
  onApply,
}: {
  open: boolean;
  slots: [DraftSlot, DraftSlot, DraftSlot];
  variables: readonly VariableOption[];
  onClose: () => void;
  onApply: (slots: [DraftSlot, DraftSlot, DraftSlot]) => void;
}) {
  const [draft, setDraft] = useState(slots);

  function setSlot(index: number, slot: DraftSlot) {
    setDraft((prev) => {
      const next = [...prev] as [DraftSlot, DraftSlot, DraftSlot];
      next[index] = slot;
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Множители строки"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Готово
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--muted-fg)]">
          Сумма = Кол-во × Ставка × множители. Множитель — переменная проекта или своё число.
        </p>
        {draft.map((slot, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem] sm:items-end">
            <div>
              <Label htmlFor={`multiplier-${index}`}>Множитель {index + 1}</Label>
              <Select
                id={`multiplier-${index}`}
                value={slot.kind === "variable" ? slot.variableId : slot.kind === "number" ? "__number" : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") setSlot(index, { kind: "none" });
                  else if (v === "__number") setSlot(index, { kind: "number", value: slot.kind === "number" ? slot.value : "" });
                  else setSlot(index, { kind: "variable", variableId: v });
                }}
              >
                <option value="">— нет</option>
                {variables.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} ({v.value == null ? "не задана" : formatNumber(v.value)})
                  </option>
                ))}
                <option value="__number">Своё число…</option>
              </Select>
            </div>
            {slot.kind === "number" ? (
              <div>
                <Label htmlFor={`multiplier-value-${index}`}>Число</Label>
                <Input
                  id={`multiplier-value-${index}`}
                  inputMode="decimal"
                  value={slot.value}
                  placeholder="0,7"
                  className="text-right tabular-nums"
                  onChange={(e) => setSlot(index, { kind: "number", value: e.target.value })}
                />
              </div>
            ) : null}
          </div>
        ))}
        <p className="text-xs text-[var(--muted-fg)]">
          Можно ввести число, например 0,7 — скидка 30%.
        </p>
      </div>
    </Modal>
  );
}
