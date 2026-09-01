"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createResourceCategoryAction,
  updateResourceCategoryAction,
  type ResourceActionState,
} from "@/features/resources/actions";
import type { ResourceCategoryRow } from "@/features/resources/queries";
import { useActionToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

const initial: ResourceActionState = {};

function CategoryFormFields({ category }: { category?: ResourceCategoryRow }) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="name">Название категории *</Label>
        <Input id="name" name="name" required defaultValue={category?.name} />
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
      </div>
    </div>
  );
}

export function CategoryModal({
  projectId,
  open,
  onClose,
  category,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  category?: ResourceCategoryRow;
}) {
  const isEdit = Boolean(category);
  const bound = isEdit
    ? updateResourceCategoryAction.bind(null, projectId, category!.id)
    : createResourceCategoryAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование категории" : "Новая категория"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="category-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="category-form" action={action} key={category?.id ?? "new"}>
        <CategoryFormFields category={category} />
      </form>
    </Modal>
  );
}
