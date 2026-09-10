"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createResourceItemAction,
  updateResourceItemAction,
  type ResourceActionState,
} from "@/features/resources/actions";
import {
  FinancialTermsBlock,
  seedExtras,
  seedOvertime,
} from "@/features/payroll/components/financial-terms-block";
import { formatMinutesHhMm } from "@/shared/i18n/domain-labels";
import { useActionToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { HhMmInput } from "@/shared/ui/hh-mm-input";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

const initial: ResourceActionState = {};

type ItemLike = {
  name: string;
  notes: string | null;
  shiftRate: number | null;
  shiftHoursMin: number | null;
  unpaidOvertimeMin: number | null;
  arrivalOffsetMin: number | null;
  taxPercent?: number | null;
  kmRate?: number | null;
  tracksMileage?: boolean;
  overtimeMode?: "HALF_HOUR" | "HOURLY_CUMULATIVE" | "HOURLY_FLAT" | null;
  unpaidOvertimeMode?: "FIRST_HOUR" | "EACH_HOUR" | null;
  overtimeRates?: Array<{
    hourNumber: number;
    percentRate: { toString(): string } | null;
    amount: { toString(): string } | null;
    taxPercent: { toString(): string } | null;
  }>;
  extraPayments?: Array<{
    paymentDate: Date | null;
    amount: { toString(): string };
    taxPercent: { toString(): string } | null;
    taxAmount?: { toString(): string } | null;
    totalWithTax?: { toString(): string } | null;
    description: string | null;
  }>;
};

function ItemFormFields({
  item,
  showFinance = true,
  financeReadOnly = false,
}: {
  item?: ItemLike;
  showFinance?: boolean;
  financeReadOnly?: boolean;
}) {
  const [arrivalOffset, setArrivalOffset] = useState(
    () => formatMinutesHhMm(item?.arrivalOffsetMin) || "",
  );

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="name">Название *</Label>
        <Input id="name" name="name" required defaultValue={item?.name} />
      </div>
      <div>
        <Label htmlFor="notes">Примечание</Label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="glass-input w-full resize-y px-3 py-2 text-sm"
          defaultValue={item?.notes ?? ""}
        />
      </div>
      <div>
        <Label htmlFor="arrivalOffsetMin">Смещение прибытия</Label>
        <input type="hidden" name="arrivalOffsetMin" value={arrivalOffset} />
        <HhMmInput
          id="arrivalOffsetMin"
          mode="duration"
          value={arrivalOffset}
          onChange={setArrivalOffset}
          placeholder="01:00"
        />
        <p className="mt-1 text-[10px] text-[var(--muted-fg)]">
          Относительно начала смены, формат ЧЧ:ММ
        </p>
      </div>

      {showFinance ? (
        financeReadOnly ? (
          <div className="border-t border-[var(--border)] pt-4 text-sm">
            <h4 className="mb-2 font-semibold">Финансовые условия</h4>
            <p className="text-[var(--muted-fg)]">
              Стоимость смены: {item?.shiftRate ?? "—"}
              {item?.taxPercent != null ? ` · налог ${item.taxPercent}%` : ""}
              {item?.tracksMileage && item.kmRate != null
                ? ` · ${item.kmRate} ₽/км`
                : ""}
            </p>
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              Нет прав на редактирование финансовых условий этой категории.
            </p>
          </div>
        ) : (
          <FinancialTermsBlock
            title="Финансовые условия"
            shiftRate={item?.shiftRate ?? 0}
            taxPercent={item?.taxPercent ? Number(item.taxPercent) : 0}
            shiftHoursMin={item?.shiftHoursMin}
            unpaidOvertimeMin={item?.unpaidOvertimeMin}
            overtimeMode={item?.overtimeMode}
            unpaidOvertimeMode={item?.unpaidOvertimeMode}
            overtime={
              item?.overtimeRates ? seedOvertime(item.overtimeRates) : []
            }
            extras={item?.extraPayments ? seedExtras(item.extraPayments) : []}
            showExtras
            showKmRate={Boolean(item?.tracksMileage)}
            kmRate={item?.kmRate ?? null}
          />
        )
      ) : null}
    </div>
  );
}

export function ItemModal({
  projectId,
  categoryId,
  open,
  onClose,
  itemId,
  item,
  tracksMileage = false,
  canFinanceRead = true,
  canFinanceWrite = true,
}: {
  projectId: string;
  categoryId: string;
  open: boolean;
  onClose: () => void;
  itemId?: string;
  item?: ItemLike;
  tracksMileage?: boolean;
  canFinanceRead?: boolean;
  canFinanceWrite?: boolean;
}) {
  const bound = itemId
    ? updateResourceItemAction.bind(null, projectId, categoryId, itemId)
    : createResourceItemAction.bind(null, projectId, categoryId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  const formItem: ItemLike | undefined = item
    ? { ...item, tracksMileage: item.tracksMileage ?? tracksMileage }
    : tracksMileage
      ? {
          name: "",
          notes: null,
          shiftRate: null,
          shiftHoursMin: null,
          unpaidOvertimeMin: null,
          arrivalOffsetMin: null,
          tracksMileage: true,
        }
      : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={itemId ? "Редактирование ресурса" : "Новый ресурс"}
      wide={canFinanceRead}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="resource-item-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="resource-item-form" action={action} key={itemId ?? "new"}>
        <ItemFormFields
          item={formItem}
          showFinance={canFinanceRead}
          financeReadOnly={!canFinanceWrite}
        />
      </form>
    </Modal>
  );
}
