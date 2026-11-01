"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
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
import {
  saveCallSheetSectionsAction,
  type CallSheetElementsActionState,
} from "@/features/call-sheets/elements-actions";
import type { SectionsEditorRow } from "@/features/call-sheets/elements-queries";
import { MAX_SECTION_NAME } from "@/features/call-sheets/lib/elements-rules";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { Input } from "@/shared/ui/input";
import { useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";
import { useFormGuard } from "@/shared/ui/unsaved/use-form-guard";

type Row = SectionsEditorRow & { rowKey: string };

const initial: CallSheetElementsActionState = {};

function rowsWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "строка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "строки";
  return "строк";
}

function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2 text-sm",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
        aria-label="Перетащить раздел"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      {children}
    </div>
  );
}

/**
 * Разделы элементов площадки проекта (блок на экране «Шаблон вызывного»):
 * переименовать, порядок, свой раздел — добавить и удалить. Системный не удаляется.
 */
export function CallSheetSectionsEditor({
  projectId,
  sections,
}: {
  projectId: string;
  sections: SectionsEditorRow[];
}) {
  const bound = saveCallSheetSectionsAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  const { ref, markClean } = useFormGuard<HTMLFormElement>(true, undefined, state);
  useActionSuccess(state, markClean);
  const confirm = useConfirm();

  const nextKey = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    sections.map((row, index) => ({ ...row, rowKey: `s${index}` })),
  );
  const [confirmedDeletes, setConfirmedDeletes] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const dndId = useId();

  const payload = JSON.stringify({
    sections: rows.map((row) => ({ id: row.id, key: row.key, name: row.name })),
    confirmedDeletes,
  });

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((list) => {
      const oldIndex = list.findIndex((r) => r.rowKey === active.id);
      const newIndex = list.findIndex((r) => r.rowKey === over.id);
      if (oldIndex < 0 || newIndex < 0) return list;
      return arrayMove(list, oldIndex, newIndex);
    });
  }

  function remove(row: Row) {
    const drop = () => setRows((list) => list.filter((r) => r.rowKey !== row.rowKey));
    if (row.elementCount === 0) {
      drop();
      return;
    }
    void confirm({
      title: `Удалить раздел «${row.name || "без названия"}»?`,
      details: [
        `В вызывных в этом разделе ${row.elementCount} ${rowsWord(row.elementCount)} — они удалятся вместе с разделом.`,
        "Удаление произойдёт, когда вы нажмёте «Сохранить разделы».",
      ],
      confirmLabel: "Удалить",
      action: async () => {
        setConfirmedDeletes((ids) => [...ids, row.id]);
        drop();
      },
    });
  }

  return (
    <form ref={ref} onSubmit={submitKeepingFields(action)} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      <div>
        <h3 className="text-base font-semibold">Разделы элементов площадки</h3>
        <p className="mt-0.5 text-xs text-[var(--muted-fg)]">
          Разделы таблицы «Элементы площадки» в вызывных. Системные разделы заполняются из разбора
          сцен — их можно переименовать и передвинуть, но не удалить. Свои разделы — для ручных
          строк.
        </p>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={rows.map((r) => r.rowKey)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <SortableRow key={row.rowKey} id={row.rowKey}>
                <Input
                  aria-label={`Название раздела ${index + 1}`}
                  placeholder={row.defaultName ?? "Название раздела *"}
                  required
                  maxLength={MAX_SECTION_NAME}
                  className="min-w-0 flex-1"
                  value={row.name}
                  onChange={(e) =>
                    setRows((list) =>
                      list.map((r) => (r.rowKey === row.rowKey ? { ...r, name: e.target.value } : r)),
                    )
                  }
                />
                <span className="text-xs text-[var(--muted-fg)]">
                  {row.key
                    ? row.defaultName && row.defaultName !== row.name.trim()
                      ? `системный · «${row.defaultName}»`
                      : "системный"
                    : row.elementCount > 0
                      ? `свой · ${row.elementCount} ${rowsWord(row.elementCount)}`
                      : "свой"}
                </span>
                {row.key ? (
                  <span className="w-9" aria-hidden />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Удалить раздел ${index + 1}`}
                    title="Удалить раздел"
                    onClick={() => remove(row)}
                  >
                    ✕
                  </Button>
                )}
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setRows((list) => [
              ...list,
              {
                rowKey: `n${nextKey.current++}`,
                id: "",
                key: "",
                name: "",
                defaultName: null,
                elementCount: 0,
              },
            ])
          }
        >
          + Свой раздел
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Сохранить разделы"}
        </Button>
      </div>
    </form>
  );
}
