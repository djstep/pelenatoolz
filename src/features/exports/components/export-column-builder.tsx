"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  createExportColumnId,
  findFieldUsage,
  suggestedColumnTitle,
} from "@/features/exports/lib/column-utils";
import {
  EXTRAS_BUCKET_HEADER,
  type ExportColumn,
  type ExportFieldDef,
} from "@/features/exports/types";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PortaledMenu } from "@/shared/ui/portaled-menu";
import { useToast } from "@/shared/ui/toast";

type Props = {
  fields: ExportFieldDef[];
  value: ExportColumn[];
  onChange: (columns: ExportColumn[]) => void;
  className?: string;
};

function colDragId(columnId: string) {
  return `col:${columnId}`;
}

function fieldDragId(columnId: string, index: number) {
  return `fld:${columnId}:${index}`;
}

function parseColId(id: string): string | null {
  return id.startsWith("col:") ? id.slice(4) : null;
}

function parseFieldDragId(
  id: string,
): { columnId: string; index: number } | null {
  if (!id.startsWith("fld:")) return null;
  const rest = id.slice(4);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon <= 0) return null;
  const columnId = rest.slice(0, lastColon);
  const index = Number(rest.slice(lastColon + 1));
  if (!columnId || Number.isNaN(index)) return null;
  return { columnId, index };
}

function fieldLabel(fields: ExportFieldDef[], fieldId: string) {
  return fields.find((f) => f.id === fieldId)?.label ?? fieldId;
}

function ColumnMenu({
  children,
  open,
  onClose,
  anchorRef,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  return (
    <PortaledMenu
      open={open}
      anchorRef={anchorRef}
      onClose={onClose}
      role="menu"
      align="end"
      minWidth={176}
      className="py-1"
    >
      {children}
    </PortaledMenu>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "glass-dropdown-item block w-full px-3 py-2 text-left text-sm",
        danger && "text-[var(--danger)]",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SortableFieldChip({
  id,
  label,
  onRemove,
}: {
  id: string;
  label: string;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs",
        isDragging && "z-10 opacity-50",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-[var(--muted-fg)] active:cursor-grabbing"
        aria-label="Перетащить ресурс"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        className="rounded px-1 text-[var(--muted-fg)] opacity-60 hover:bg-white/10 hover:opacity-100"
        aria-label="Убрать"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

function FieldAddMenu({
  fields,
  usedFieldIds,
  onAdd,
}: {
  fields: ExportFieldDef[];
  usedFieldIds: Set<string>;
  onAdd: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);

  return (
    <div className="relative">
      <span ref={triggerRef} className="block">
        <Button
          type="button"
          variant="ghost"
          className="h-7 w-full justify-center text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          +
        </Button>
      </span>
      <PortaledMenu
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        minWidth={224}
        className="py-1"
      >
        {fields.map((field) => {
          const used = usedFieldIds.has(field.id);
          return (
            <button
              key={field.id}
              type="button"
              className="glass-dropdown-item flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
              onClick={() => {
                onAdd(field.id);
                setOpen(false);
              }}
            >
              <span>{field.label}</span>
              {used ? (
                <span className="shrink-0 text-[10px] text-[var(--muted-fg)]">
                  уже есть
                </span>
              ) : null}
            </button>
          );
        })}
      </PortaledMenu>
    </div>
  );
}

function ExportColumnCard({
  column,
  fields,
  canRemove,
  usedElsewhere,
  onChange,
  onAddColumnAfter,
  onRemove,
  onAddField,
  onRemoveField,
}: {
  column: ExportColumn;
  fields: ExportFieldDef[];
  canRemove: boolean;
  usedElsewhere: Set<string>;
  onChange: (patch: Partial<ExportColumn>) => void;
  onAddColumnAfter: () => void;
  onRemove: () => void;
  onAddField: (fieldId: string) => void;
  onRemoveField: (index: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLSpanElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: colDragId(column.id) });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${column.id}`,
    data: { columnId: column.id },
  });

  const fieldIds = column.fieldIds.map((_, i) => fieldDragId(column.id, i));

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex w-56 shrink-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface-1)]",
        isDragging && "z-20 opacity-60 shadow-lg",
        isOver && "ring-1 ring-[var(--accent)]",
      )}
    >
      <div className="flex items-start gap-1 border-b border-[var(--border)]/70 p-2">
        <button
          type="button"
          className="mt-1.5 cursor-grab touch-none px-0.5 text-[var(--muted-fg)] active:cursor-grabbing"
          aria-label="Перетащить столбец"
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            className="h-8 text-sm"
            value={column.isExtrasBucket ? EXTRAS_BUCKET_HEADER : column.title}
            disabled={column.isExtrasBucket}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Заголовок"
          />
          {column.isExtrasBucket ? (
            <p className="text-[10px] text-[var(--muted-fg)]">Сборный столбец</p>
          ) : null}
        </div>
        <div className="relative">
          <span ref={menuBtnRef} className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label="Меню столбца"
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋯
            </Button>
          </span>
          <ColumnMenu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={menuBtnRef}
          >
            <MenuItem
              onClick={() => {
                onAddColumnAfter();
                setMenuOpen(false);
              }}
            >
              Добавить столбец
            </MenuItem>
            <MenuItem
              onClick={() => {
                onChange({ isExtrasBucket: !column.isExtrasBucket });
                setMenuOpen(false);
              }}
            >
              {column.isExtrasBucket
                ? "Обычный столбец"
                : "Доп. ресурсы"}
            </MenuItem>
            {canRemove ? (
              <MenuItem
                danger
                onClick={() => {
                  onRemove();
                  setMenuOpen(false);
                }}
              >
                Удалить столбец
              </MenuItem>
            ) : null}
          </ColumnMenu>
        </div>
      </div>

      <div
        ref={setDropRef}
        className="flex min-h-[7rem] flex-1 flex-col gap-1.5 p-2"
      >
        <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
          {column.fieldIds.map((fid, index) => (
            <SortableFieldChip
              key={fieldDragId(column.id, index)}
              id={fieldDragId(column.id, index)}
              label={fieldLabel(fields, fid)}
              onRemove={() => onRemoveField(index)}
            />
          ))}
        </SortableContext>
        <FieldAddMenu
          fields={fields}
          usedFieldIds={usedElsewhere}
          onAdd={onAddField}
        />
      </div>
    </div>
  );
}

export function ExportColumnBuilder({
  fields,
  value,
  onChange,
  className,
}: Props) {
  const toast = useToast();
  const [activeFieldLabel, setActiveFieldLabel] = useState<string | null>(null);
  const columns = value;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const usedGlobal = useMemo(() => {
    const set = new Set<string>();
    for (const col of columns) {
      for (const id of col.fieldIds) set.add(id);
    }
    return set;
  }, [columns]);

  const columnSortIds = columns.map((c) => colDragId(c.id));

  function updateColumns(next: ExportColumn[]) {
    onChange(next);
  }

  function insertColumnAfter(afterId: string) {
    const id = createExportColumnId();
    const nextCol: ExportColumn = { id, title: "Столбец", fieldIds: [] };
    const idx = columns.findIndex((c) => c.id === afterId);
    if (idx < 0) {
      updateColumns([...columns, nextCol]);
      return;
    }
    const next = [...columns];
    next.splice(idx + 1, 0, nextCol);
    updateColumns(next);
  }

  function addField(columnId: string, fieldId: string) {
    const others = findFieldUsage(columns, fieldId, columnId);
    if (others.length > 0 || usedGlobal.has(fieldId)) {
      const names = findFieldUsage(columns, fieldId)
        .map((c) => c.title || "столбец")
        .join(", ");
      toast.warning(
        names
          ? `«${fieldLabel(fields, fieldId)}» уже используется (${names})`
          : `«${fieldLabel(fields, fieldId)}» уже используется в другом столбце`,
      );
    }
    updateColumns(
      columns.map((col) => {
        if (col.id !== columnId) return col;
        const fieldIds = [...col.fieldIds, fieldId];
        const titleAuto =
          !col.isExtrasBucket &&
          (col.title === suggestedColumnTitle(col.fieldIds, fields) ||
            col.title === "Столбец");
        return {
          ...col,
          fieldIds,
          title: titleAuto
            ? suggestedColumnTitle(fieldIds, fields)
            : col.title,
        };
      }),
    );
  }

  function removeField(columnId: string, index: number) {
    updateColumns(
      columns.map((col) => {
        if (col.id !== columnId) return col;
        const fieldIds = col.fieldIds.filter((_, i) => i !== index);
        const titleAuto =
          !col.isExtrasBucket &&
          col.title === suggestedColumnTitle(col.fieldIds, fields);
        return {
          ...col,
          fieldIds,
          title: titleAuto
            ? suggestedColumnTitle(fieldIds, fields)
            : col.title,
        };
      }),
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const parsed = parseFieldDragId(String(event.active.id));
    if (!parsed) {
      setActiveFieldLabel(null);
      return;
    }
    const col = columns.find((c) => c.id === parsed.columnId);
    const fid = col?.fieldIds[parsed.index];
    setActiveFieldLabel(fid ? fieldLabel(fields, fid) : null);
  }

  function moveField(
    fromColId: string,
    fromIndex: number,
    toColId: string,
    toIndex: number,
  ) {
    const fromCol = columns.find((c) => c.id === fromColId);
    if (!fromCol) return;
    const fieldId = fromCol.fieldIds[fromIndex];
    if (fieldId == null) return;

    if (fromColId === toColId) {
      if (fromIndex === toIndex) return;
      updateColumns(
        columns.map((col) => {
          if (col.id !== fromColId) return col;
          return {
            ...col,
            fieldIds: arrayMove(col.fieldIds, fromIndex, toIndex),
          };
        }),
      );
      return;
    }

    updateColumns(
      columns.map((col) => {
        if (col.id === fromColId) {
          return {
            ...col,
            fieldIds: col.fieldIds.filter((_, i) => i !== fromIndex),
          };
        }
        if (col.id === toColId) {
          const next = [...col.fieldIds];
          const insertAt = Math.max(0, Math.min(toIndex, next.length));
          next.splice(insertAt, 0, fieldId);
          return { ...col, fieldIds: next };
        }
        return col;
      }),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveFieldLabel(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeCol = parseColId(activeId);
    const overCol =
      parseColId(overId) ??
      (overId.startsWith("drop:") ? overId.slice(5) : null);
    // Column reorder: active is column, over is column header or another column
    if (activeCol && overCol && activeId.startsWith("col:")) {
      const oldIndex = columns.findIndex((c) => c.id === activeCol);
      const newIndex = columns.findIndex((c) => c.id === overCol);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      updateColumns(arrayMove(columns, oldIndex, newIndex));
      return;
    }

    if (!activeId.startsWith("fld:")) return;
    const from = parseFieldDragId(activeId);
    if (!from) return;

    if (overId.startsWith("fld:")) {
      const to = parseFieldDragId(overId);
      if (!to) return;
      moveField(from.columnId, from.index, to.columnId, to.index);
      return;
    }

    if (overId.startsWith("drop:")) {
      const toColId = overId.slice(5);
      const dest = columns.find((c) => c.id === toColId);
      moveField(
        from.columnId,
        from.index,
        toColId,
        dest?.fieldIds.length ?? 0,
      );
      return;
    }

    if (overId.startsWith("col:")) {
      const toColId = parseColId(overId);
      if (!toColId) return;
      const dest = columns.find((c) => c.id === toColId);
      moveField(
        from.columnId,
        from.index,
        toColId,
        dest?.fieldIds.length ?? 0,
      );
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={columnSortIds}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex max-w-full gap-3 overflow-x-auto pb-2">
            {columns.map((col) => (
              <ExportColumnCard
                key={col.id}
                column={col}
                fields={fields}
                canRemove={columns.length > 1}
                usedElsewhere={usedGlobal}
                onChange={(patch) =>
                  updateColumns(
                    columns.map((c) =>
                      c.id === col.id ? { ...c, ...patch } : c,
                    ),
                  )
                }
                onAddColumnAfter={() => insertColumnAfter(col.id)}
                onRemove={() =>
                  updateColumns(columns.filter((c) => c.id !== col.id))
                }
                onAddField={(fieldId) => addField(col.id, fieldId)}
                onRemoveField={(index) => removeField(col.id, index)}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeFieldLabel ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs shadow-lg">
              {activeFieldLabel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
