"use client";

import { useActionState } from "react";
import {
  createResourceCategoryAction,
  updateResourceCategoryAction,
  type ResourceActionState,
} from "@/features/resources/actions";
import type { ResourceCategoryRow } from "@/features/resources/queries";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useActionToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { AUTO_SECTION } from "@/features/resources/lib/category-section";

const initial: ResourceActionState = {};

/** Раздел элементов площадки вызывного: id раздела или «key:КЛЮЧ» (системный, ещё не в базе). */
export type CallSheetSectionOption = { ref: string; name: string };

function CategoryFormFields({
  category,
  sections,
}: {
  category?: ResourceCategoryRow;
  sections: CallSheetSectionOption[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="name">Название категории *</Label>
        <Input id="name" name="name" required defaultValue={category?.name} />
      </div>
      <div>
        <Label htmlFor="callSheetSection">Раздел вызывного</Label>
        <Select
          id="callSheetSection"
          name="callSheetSection"
          defaultValue={category ? (category.callSheetSectionId ?? "") : AUTO_SECTION}
        >
          {category ? null : (
            <option value={AUTO_SECTION}>По названию категории (если совпадает с разделом)</option>
          )}
          <option value="">Без раздела — в «Прочее»</option>
          {sections.map((s) => (
            <option key={s.ref} value={s.ref}>
              {s.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-[var(--muted-fg)]">
          В какой раздел «Элементов площадки» вызывного попадают ресурсы этой категории — из сцен
          и посменные, добавленные в день (с их временем подачи).
        </p>
      </div>
      <div className="space-y-2 text-sm">
        <p className="font-medium">Настройки</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="fillInScenes"
            defaultChecked={category?.fillInScenes ?? true}
          />
          Заполняется в сценах
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="perShift"
            defaultChecked={category?.perShift ?? false}
          />
          Заполняется применительно к смене
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="countable"
            defaultChecked={category?.countable ?? false}
          />
          Счётный (количество в сцене)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="showInKpp"
            defaultChecked={category?.showInKpp ?? true}
          />
          Выводить в КПП
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="tracksMileage"
            defaultChecked={category?.tracksMileage ?? false}
          />
          Учитывать километраж (игровой / спецтранспорт)
        </label>
      </div>
    </div>
  );
}

export function CategoryModal({
  projectId,
  open,
  onClose,
  category,
  sections,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  category?: ResourceCategoryRow;
  sections: CallSheetSectionOption[];
}) {
  const isEdit = Boolean(category);
  const bound = isEdit
    ? updateResourceCategoryAction.bind(null, projectId, category!.id)
    : createResourceCategoryAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useActionSuccess(state, onClose);

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование категории" : "Новая категория"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="category-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            data-modal-cancel
            onClick={onClose}
          >
            Отмена
          </Button>
        </div>
      }
    >
      <form id="category-form" onSubmit={submitKeepingFields(action)} key={category?.id ?? "new"}>
        <CategoryFormFields category={category} sections={sections} />
      </form>
    </Modal>
  );
}
