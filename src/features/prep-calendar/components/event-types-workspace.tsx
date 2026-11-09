"use client";

import { useState, useTransition } from "react";
import {
  createPrepEventTypeAction,
  deletePrepEventTypeAction,
  setPrepEventTypeHiddenAction,
  updatePrepEventTypeAction,
  type PrepEventTypeActionState,
} from "@/features/prep-calendar/actions";
import {
  PREP_EVENT_COLORS,
  prepEventColorStyle,
} from "@/features/prep-calendar/lib/event-colors";
import type { PrepEventTypeRow } from "@/features/prep-calendar/queries";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { toast, useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";

const initial: PrepEventTypeActionState = {};

function TypeBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center rounded-[5px] border px-2 py-0.5 text-xs font-semibold"
      style={prepEventColorStyle(color)}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}

function EventTypeModal({
  projectId,
  type,
  open,
  onClose,
}: {
  projectId: string;
  type?: PrepEventTypeRow;
  open: boolean;
  onClose: () => void;
}) {
  const bound = type
    ? updatePrepEventTypeAction.bind(null, projectId, type.id)
    : createPrepEventTypeAction.bind(null, projectId);
  const [state, action, pending] = useSafeActionState(bound, initial);
  useActionToast(state);
  useActionSuccess(state, onClose);

  // После ошибки React сбрасывает форму к значениям по умолчанию — подставляем введённое.
  const entered = state.values;
  const color = entered?.color ?? type?.color ?? PREP_EVENT_COLORS[0].key;

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={onClose}
      title={type ? `Тип события: ${type.name}` : "Новый тип события"}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="event-type-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="event-type-form" onSubmit={submitKeepingFields(action)} className="space-y-4">
        <div>
          <Label htmlFor="event-type-name">Название *</Label>
          <Input
            id="event-type-name"
            name="name"
            required
            maxLength={60}
            defaultValue={entered?.name ?? type?.name}
            placeholder="Костюмная примерка"
          />
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold">Цвет *</legend>
          <div className="flex flex-wrap gap-2">
            {PREP_EVENT_COLORS.map((option) => (
              <label
                key={option.key}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold has-[:focus-visible]:shadow-[var(--focus-ring)]"
                style={prepEventColorStyle(option.key)}
              >
                <input
                  type="radio"
                  name="color"
                  value={option.key}
                  defaultChecked={option.key === color}
                  className="accent-current"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function EventTypeRow({
  projectId,
  type,
  onEdit,
}: {
  projectId: string;
  type: PrepEventTypeRow;
  onEdit: () => void;
}) {
  const confirmDelete = useConfirm();
  const [pending, startTransition] = useTransition();

  function toggleHidden() {
    startTransition(async () => {
      const result = await setPrepEventTypeHiddenAction(projectId, type.id, !type.isHidden);
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <TypeBadge name={type.name} color={type.color} />
        {type.isHidden ? (
          <span className="text-xs font-semibold text-[var(--muted-fg)]">Скрыт</span>
        ) : null}
        <span className="text-xs tabular-nums text-[var(--muted-fg)]">
          {type.eventCount > 0 ? `Событий: ${type.eventCount}` : "Событий нет"}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onEdit}>
          Изменить
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={toggleHidden}>
          {type.isHidden ? "Показать" : "Скрыть"}
        </Button>
        {type.eventCount === 0 ? (
          <Button
            type="button"
            variant="danger"
            onClick={() =>
              void confirmDelete({
                title: `Удалить тип «${type.name}»?`,
                action: async () => (await deletePrepEventTypeAction(projectId, type.id)).error,
              })
            }
          >
            Удалить
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function EventTypesWorkspace({
  projectId,
  types,
}: {
  projectId: string;
  types: PrepEventTypeRow[];
}) {
  const [editing, setEditing] = useState<PrepEventTypeRow | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => setCreating(true)}>
          + Добавить тип
        </Button>
        <p className="text-xs text-[var(--muted-fg)]">
          Тип с событиями удалить нельзя, его можно скрыть: в новых событиях он не предлагается,
          старые остаются.
        </p>
      </div>

      <ul className="space-y-2">
        {types.map((type) => (
          <EventTypeRow
            key={type.id}
            projectId={projectId}
            type={type}
            onEdit={() => setEditing(type)}
          />
        ))}
      </ul>

      <EventTypeModal
        // Новый key на каждое открытие: форма начинает с чистого состояния, без прошлого «успеха».
        key={editing?.id ?? (creating ? "new" : "closed")}
        projectId={projectId}
        type={editing ?? undefined}
        open={creating || editing != null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
