"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import {
  createDefaultExportColumns,
  createExportColumnId,
  LIBRETTO_EXPORT_FIELDS,
  suggestedExportColumnTitle,
  type LibrettoExportColumn,
} from "@/features/script/lib/libretto-fields";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Modal } from "@/shared/ui/modal";
import { cn } from "@/shared/lib/cn";

function DragHandle({
  listeners,
  attributes,
}: {
  listeners?: object;
  attributes?: object;
}) {
  return (
    <button
      type="button"
      className="shrink-0 cursor-grab touch-none rounded px-1 py-2 text-[var(--muted-fg)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)] active:cursor-grabbing"
      aria-label="Перетащить столбец"
      {...attributes}
      {...listeners}
      onClick={(e) => e.stopPropagation()}
    >
      ⠿
    </button>
  );
}

function SortableExportColumnItem({
  col,
  expanded,
  canRemove,
  onToggleExpand,
  onUpdateTitle,
  onToggleField,
  onRemove,
}: {
  col: LibrettoExportColumn;
  expanded: boolean;
  canRemove: boolean;
  onToggleExpand: () => void;
  onUpdateTitle: (title: string) => void;
  onToggleField: (fieldId: string) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: col.id });

  const fieldLabels = col.fieldIds
    .map(
      (id) =>
        LIBRETTO_EXPORT_FIELDS.find((field) => field.id === id)?.label,
    )
    .filter(Boolean)
    .join(", ");

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3",
        isDragging && "z-10 opacity-60 shadow-lg",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DragHandle listeners={listeners} attributes={attributes} />
        <Input
          className="min-w-[10rem] flex-1"
          value={col.title}
          onChange={(e) => onUpdateTitle(e.target.value)}
          placeholder="Заголовок столбца"
        />
        <Button type="button" variant="secondary" onClick={onToggleExpand}>
          {expanded ? "Скрыть поля" : "Поля"}
        </Button>
        {canRemove ? (
          <Button type="button" variant="ghost" onClick={onRemove}>
            Удалить
          </Button>
        ) : null}
      </div>

      {!expanded && fieldLabels ? (
        <p className="mt-2 pl-8 text-xs text-[var(--muted-fg)]">{fieldLabels}</p>
      ) : null}

      {expanded ? (
        <div className="mt-3 grid gap-1 pl-8 sm:grid-cols-2">
          {LIBRETTO_EXPORT_FIELDS.map((field) => (
            <label
              key={field.id}
              className="flex items-center gap-2 rounded-lg px-1 py-1 text-sm"
            >
              <input
                type="checkbox"
                checked={col.fieldIds.includes(field.id)}
                onChange={() => onToggleField(field.id)}
              />
              {field.label}
            </label>
          ))}
        </div>
      ) : null}

      {col.fieldIds.length === 0 ? (
        <p className="mt-2 pl-8 text-xs text-[var(--danger)]">
          Выберите хотя бы одно поле
        </p>
      ) : null}
    </li>
  );
}

export function LibrettoExportModal({
  open,
  onClose,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  onExport: (columns: LibrettoExportColumn[]) => void | Promise<void>;
}) {
  const [columns, setColumns] = useState<LibrettoExportColumn[]>(() =>
    createDefaultExportColumns(),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (!open) return;
    setColumns(createDefaultExportColumns());
    setExpandedId(null);
  }, [open]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setColumns((prev) => {
      const oldIndex = prev.findIndex((col) => col.id === active.id);
      const newIndex = prev.findIndex((col) => col.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function updateColumn(id: string, patch: Partial<LibrettoExportColumn>) {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, ...patch } : col)),
    );
  }

  function toggleField(columnId: string, fieldId: string) {
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id !== columnId) return col;
        const has = col.fieldIds.includes(fieldId);
        const fieldIds = has
          ? col.fieldIds.filter((id) => id !== fieldId)
          : [...col.fieldIds, fieldId];
        const titleAuto =
          col.title === suggestedExportColumnTitle(col.fieldIds) ||
          col.title === "Столбец";
        return {
          ...col,
          fieldIds,
          title: titleAuto ? suggestedExportColumnTitle(fieldIds) : col.title,
        };
      }),
    );
  }

  function addColumn() {
    const id = createExportColumnId();
    setColumns((prev) => [
      ...prev,
      { id, title: "Столбец", fieldIds: [] },
    ]);
    setExpandedId(id);
  }

  function removeColumn(id: string) {
    setColumns((prev) => prev.filter((col) => col.id !== id));
  }

  const canExport = columns.some((col) => col.fieldIds.length > 0);

  return (
    <Modal open={open} onClose={onClose} title="Экспорт либретто" wide>
      <p className="mb-3 text-sm text-[var(--muted-fg)]">
        Настройте столбцы Excel: один столбец может содержать несколько
        параметров (например, массовку и групповку вместе). Перетаскивайте
        столбцы за ручку ⠿. При объединении названия параметров в ячейке
        будут выделены жирным.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setColumns(createDefaultExportColumns())}
        >
          Как в таблице
        </Button>
        <Button type="button" variant="secondary" onClick={addColumn}>
          + Столбец
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={columns.map((col) => col.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {columns.map((col) => (
              <SortableExportColumnItem
                key={col.id}
                col={col}
                expanded={expandedId === col.id}
                canRemove={columns.length > 1}
                onToggleExpand={() =>
                  setExpandedId((prev) => (prev === col.id ? null : col.id))
                }
                onUpdateTitle={(title) => updateColumn(col.id, { title })}
                onToggleField={(fieldId) => toggleField(col.id, fieldId)}
                onRemove={() => removeColumn(col.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          disabled={!canExport}
          onClick={() => {
            onExport(columns.filter((col) => col.fieldIds.length > 0));
            onClose();
          }}
        >
          Экспортировать XLS
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Отмена
        </Button>
      </div>
    </Modal>
  );
}
