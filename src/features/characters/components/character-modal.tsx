"use client";

import { useActionState, useEffect } from "react";
import {
  createCharacterRecordAction,
  updateCharacterRecordAction,
  type CharacterActionState,
} from "@/features/characters/actions";
import type { CharacterEditSource } from "@/features/characters/queries";
import { useActionToast } from "@/shared/ui/toast";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

const initial: CharacterActionState = {};

export function CharacterModal({
  projectId,
  open,
  onClose,
  character,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  character?: CharacterEditSource | null;
}) {
  const isEdit = Boolean(character);
  const bound = isEdit
    ? updateCharacterRecordAction.bind(null, projectId, character!.id)
    : createCharacterRecordAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Редактирование персонажа" : "Новый персонаж"}
      wide
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="character-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          {!isEdit ? (
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" name="createAnother" form="character-form" />
              Создать ещё
            </label>
          ) : null}
        </div>
      }
    >
      <form id="character-form" action={action} className="space-y-4" key={character?.id ?? "new"}>
        <div>
          <Label htmlFor="name">Имя персонажа *</Label>
          <Input id="name" name="name" required defaultValue={character?.name} />
        </div>
        <div>
          <Label htmlFor="description">Описание</Label>
          <textarea
            id="description"
            name="description"
            rows={3}
            className="glass-input w-full resize-y px-3 py-2 text-sm"
            defaultValue={character?.description ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="roleRequirements">Требования к роли</Label>
          <textarea
            id="roleRequirements"
            name="roleRequirements"
            rows={2}
            className="glass-input w-full resize-y px-3 py-2 text-sm"
            placeholder="Типаж, возраст, особенности…"
            defaultValue={character?.roleRequirements ?? ""}
          />
        </div>
      </form>
    </Modal>
  );
}
