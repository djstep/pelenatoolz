"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createResourceItemAction,
  updateResourceItemAction,
  type ResourceActionState,
} from "@/features/resources/actions";
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
};

function ItemFormFields({ item }: { item?: ItemLike }) {
  const [shiftHours, setShiftHours] = useState(
    () => formatMinutesHhMm(item?.shiftHoursMin) || "",
  );
  const [unpaidOvertime, setUnpaidOvertime] = useState(
    () => formatMinutesHhMm(item?.unpaidOvertimeMin) || "",
  );
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
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="shiftRate">Стоимость смены</Label>
          <Input
            id="shiftRate"
            name="shiftRate"
            type="number"
            min={0}
            defaultValue={item?.shiftRate ?? undefined}
          />
        </div>
        <div>
          <Label htmlFor="shiftHoursMin">Длительность смены</Label>
          <input type="hidden" name="shiftHoursMin" value={shiftHours} />
          <HhMmInput
            id="shiftHoursMin"
            mode="duration"
            value={shiftHours}
            onChange={setShiftHours}
            placeholder="12:00"
          />
        </div>
        <div>
          <Label htmlFor="unpaidOvertimeMin">Неоплач. переработка</Label>
          <input type="hidden" name="unpaidOvertimeMin" value={unpaidOvertime} />
          <HhMmInput
            id="unpaidOvertimeMin"
            mode="duration"
            value={unpaidOvertime}
            onChange={setUnpaidOvertime}
            placeholder="00:30"
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
      </div>
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
}: {
  projectId: string;
  categoryId: string;
  open: boolean;
  onClose: () => void;
  itemId?: string;
  item?: ItemLike;
}) {
  const isEdit = Boolean(itemId);
  const bound = isEdit
    ? updateResourceItemAction.bind(null, projectId, categoryId, itemId!)
    : createResourceItemAction.bind(null, projectId, categoryId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование элемента" : "Новый элемент"}
      wide
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="item-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="item-form" action={action} key={itemId ?? "new"}>
        <ItemFormFields item={item} />
      </form>
    </Modal>
  );
}
