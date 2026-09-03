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
import { cn } from "@/shared/lib/cn";

type FieldItem = { id: string; label: string };

function SortableRow({
  field,
  checked,
  onToggle,
}: {
  field: FieldItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-2 py-1.5 text-sm",
        isDragging && "z-10 shadow-md",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
        aria-label="Перетащить"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <label className="flex flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span>{field.label}</span>
      </label>
    </div>
  );
}

/** Checkbox list with drag-reorder of enabled field order (and disabled stay at end). */
export function SortableFieldChecklist({
  fields,
  orderedIds,
  onChange,
}: {
  fields: FieldItem[];
  /** Ordered list of checked field ids */
  orderedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const checkedSet = new Set(orderedIds);
  const orderedFields = [
    ...orderedIds
      .map((id) => fields.find((f) => f.id === id))
      .filter(Boolean) as FieldItem[],
    ...fields.filter((f) => !checkedSet.has(f.id)),
  ];

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedFields.findIndex((f) => f.id === active.id);
    const newIndex = orderedFields.findIndex((f) => f.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = arrayMove(orderedFields, oldIndex, newIndex);
    onChange(moved.filter((f) => checkedSet.has(f.id)).map((f) => f.id));
  }

  function toggle(id: string) {
    if (checkedSet.has(id)) {
      onChange(orderedIds.filter((x) => x !== id));
    } else {
      onChange([...orderedIds, id]);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={orderedFields.map((f) => f.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-1.5">
          {orderedFields.map((field) => (
            <SortableRow
              key={field.id}
              field={field}
              checked={checkedSet.has(field.id)}
              onToggle={() => toggle(field.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
