"use client";

import { useActionState, useId, useOptimistic, useState, useTransition } from "react";
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
  createDepartmentAction,
  deleteDepartmentAction,
  reorderDepartmentsAction,
  updateDepartmentAction,
  type DepartmentActionState,
} from "@/features/departments/actions";
import type { DepartmentRow, HeadCandidate } from "@/features/departments/queries";
import { CODE_PREFIX_HINT } from "@/features/departments/schemas";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { useConfirm } from "@/shared/ui/confirm/confirm-provider";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { toast, useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";

const initial: DepartmentActionState = {};

function DepartmentModal({
  projectId,
  department,
  candidates,
  selfMembershipId,
  canAssignSelf,
  open,
  onClose,
}: {
  projectId: string;
  department?: DepartmentRow;
  candidates: HeadCandidate[];
  selfMembershipId: string;
  canAssignSelf: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const isEdit = Boolean(department);
  const bound = isEdit
    ? updateDepartmentAction.bind(null, projectId, department!.id)
    : createDepartmentAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useActionSuccess(state, onClose);

  const currentHeads = new Set(department?.heads.map((h) => h.membershipId) ?? []);
  // После ошибки React сбрасывает форму к значениям по умолчанию — подставляем введённое.
  const entered = state.values;
  const checkedHeads = entered ? new Set(entered.headMembershipIds) : currentHeads;

  return (
    <Modal
      guardUnsaved
      open={open}
      onClose={onClose}
      title={isEdit ? `Цех: ${department?.name}` : "Новый цех"}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" form="department-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form id="department-form" action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div>
            <Label htmlFor="department-name">Название *</Label>
            <Input
              id="department-name"
              name="name"
              required
              maxLength={100}
              defaultValue={entered?.name ?? department?.name}
              placeholder="Художественный цех"
            />
          </div>
          <div>
            <Label htmlFor="department-prefix">Префикс кодов *</Label>
            <Input
              id="department-prefix"
              name="codePrefix"
              required
              maxLength={6}
              pattern="[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9]{1,5}"
              title={CODE_PREFIX_HINT}
              defaultValue={entered?.codePrefix ?? department?.codePrefix}
              placeholder="ХУД"
              className="uppercase"
            />
          </div>
        </div>
        <p className="text-xs text-[var(--muted-fg)]">
          Префикс: {CODE_PREFIX_HINT}. Коды статей сметы цеха начинаются с него.
          {isEdit
            ? " Смена префикса не меняет уже выданные коды — новый префикс только для новых строк."
            : null}
        </p>

        <div>
          <p className="mb-2 text-sm font-medium">Главы цеха</p>
          <p className="mb-3 text-xs text-[var(--muted-fg)]">
            Глава видит и правит смету своего цеха. Назначить можно только активных
            участников проекта.
            {canAssignSelf ? null : " Назначить главой себя может только продюсер."}
          </p>
          {candidates.length === 0 ? (
            <p className="text-sm text-[var(--muted-fg)]">В проекте нет активных участников.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {candidates.map((member) => {
                const isSelf = member.membershipId === selfMembershipId;
                // Не-продюсер не может назначить себя, но если уже глава — может сняться.
                const locked = isSelf && !canAssignSelf && !currentHeads.has(member.membershipId);
                return (
                  <Checkbox
                    key={member.membershipId}
                    name="headMembershipIds"
                    value={member.membershipId}
                    defaultChecked={checkedHeads.has(member.membershipId)}
                    disabled={locked}
                  >
                    <span>
                      {member.label}
                      {isSelf ? " (вы)" : ""}
                      <span className="block text-xs text-[var(--muted-fg)]">
                        {member.roleName}
                      </span>
                    </span>
                  </Checkbox>
                );
              })}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

function SortableDepartmentRow({
  department,
  onEdit,
  onDelete,
}: {
  department: DepartmentRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: department.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)]/60 bg-[var(--surface-1)] px-3 py-2.5 text-sm",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none px-1 text-[var(--muted-fg)] active:cursor-grabbing"
        aria-label={`Перетащить цех «${department.name}»`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{department.name}</div>
        <div className="text-xs text-[var(--muted-fg)]">
          {department.heads.length > 0
            ? `Главы: ${department.heads.map((h) => h.label).join(", ")}`
            : "Глава не назначен"}
        </div>
      </div>
      <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-xs text-[var(--muted-fg)]">
        {department.codePrefix}
      </span>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onEdit}>
          Изменить
        </Button>
        <Button type="button" variant="danger" onClick={onDelete}>
          Удалить
        </Button>
      </div>
    </div>
  );
}

export function DepartmentsWorkspace({
  projectId,
  departments,
  candidates,
  selfMembershipId,
  canAssignSelf,
}: {
  projectId: string;
  departments: DepartmentRow[];
  candidates: HeadCandidate[];
  selfMembershipId: string;
  canAssignSelf: boolean;
}) {
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const confirmDelete = useConfirm();
  const [, startTransition] = useTransition();
  // Новый порядок виден сразу; после ответа сервера список приходит уже упорядоченным.
  const [ordered, setOrdered] = useOptimistic(departments);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // Постоянный id: иначе служебные aria-атрибуты dnd-kit на сервере и в браузере расходятся.
  const dndId = useId();

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((d) => d.id === active.id);
    const newIndex = ordered.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = arrayMove(ordered, oldIndex, newIndex);
    startTransition(async () => {
      setOrdered(moved);
      const result = await reorderDepartmentsAction(
        projectId,
        moved.map((d) => d.id),
      );
      if (result.error) toast.error(result.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => setCreating(true)}>
          + Добавить цех
        </Button>
        {ordered.length > 1 ? (
          <p className="text-xs text-[var(--muted-fg)]">
            Порядок меняется перетаскиванием за ⠿
          </p>
        ) : null}
      </div>

      {ordered.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">
          Цехов пока нет. Добавьте первый цех и назначьте главу — он сможет вести смету цеха.
        </p>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={ordered.map((d) => d.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {ordered.map((department) => (
                <SortableDepartmentRow
                  key={department.id}
                  department={department}
                  onEdit={() => setEditing(department)}
                  onDelete={() =>
                    void confirmDelete({
                      title: `Удалить цех «${department.name}»?`,
                      details:
                        department.heads.length > 0
                          ? [`Главы будут сняты: ${department.heads.map((h) => h.label).join(", ")}`]
                          : [],
                      action: async () =>
                        (await deleteDepartmentAction(projectId, department.id)).error,
                    })
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <DepartmentModal
        // Новый key на каждое открытие: форма начинает с чистого состояния, без прошлого «успеха».
        key={editing?.id ?? (creating ? "new" : "closed")}
        projectId={projectId}
        department={editing ?? undefined}
        candidates={candidates}
        selfMembershipId={selfMembershipId}
        canAssignSelf={canAssignSelf}
        open={creating || editing != null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}
