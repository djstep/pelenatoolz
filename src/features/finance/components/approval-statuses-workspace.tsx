"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  createApprovalStatusAction,
  deleteApprovalStatusAction,
  updateApprovalStatusAction,
  type ApprovalStatusActionState,
} from "@/features/finance/actions-approval-statuses";
import { APPROVAL_STATUS_COLOR_PRESETS } from "@/features/finance/lib/approval-statuses";
import type { ApprovalStatusRow } from "@/features/finance/queries-approval-statuses";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useActionToast } from "@/shared/ui/toast";

const initial: ApprovalStatusActionState = {};

function ColorField({
  id,
  defaultValue,
}: {
  id: string;
  defaultValue: string;
}) {
  const [color, setColor] = useState(defaultValue);

  useEffect(() => {
    setColor(defaultValue);
  }, [defaultValue]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Цвет</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-md border border-[var(--border)] bg-transparent p-1"
          aria-label="Выбор цвета"
        />
        <Input
          id={id}
          name="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          placeholder="#22c55e"
          className="max-w-[9rem] font-mono text-sm"
          required
          pattern="#([0-9a-fA-F]{6})"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {APPROVAL_STATUS_COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            title={preset}
            className="h-6 w-6 rounded-full border border-white/20 ring-offset-1 ring-offset-[var(--panel-solid)] transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            style={{ backgroundColor: preset }}
            onClick={() => setColor(preset)}
          />
        ))}
      </div>
    </div>
  );
}

function StatusModal({
  projectId,
  status,
  open,
  onClose,
}: {
  projectId: string;
  status?: ApprovalStatusRow;
  open: boolean;
  onClose: () => void;
}) {
  const bound = status
    ? updateApprovalStatusAction.bind(null, projectId, status.id)
    : createApprovalStatusAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={status ? "Редактирование статуса" : "Новый статус согласования"}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="approval-status-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          {state.error ? (
            <span className="w-full text-sm text-[var(--danger)]">
              {state.error}
            </span>
          ) : null}
        </div>
      }
    >
      <form id="approval-status-form" action={action} className="space-y-4">
        <div>
          <Label htmlFor="approval-name">Название</Label>
          <Input
            id="approval-name"
            name="name"
            required
            maxLength={80}
            defaultValue={status?.name ?? ""}
            placeholder="Например: На доработке"
          />
        </div>
        <ColorField
          id="approval-color"
          defaultValue={status?.color ?? "#64748b"}
        />
      </form>
    </Modal>
  );
}

export function ApprovalStatusesWorkspace({
  projectId,
  statuses,
  canWrite,
}: {
  projectId: string;
  statuses: ApprovalStatusRow[];
  canWrite: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalStatusRow | undefined>();
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }

  function openEdit(row: ApprovalStatusRow) {
    setEditing(row);
    setModalOpen(true);
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">
            Статусы согласования
          </h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Справочник для документов и договоров. Системные статусы можно
            переименовать и перекрасить, удалять — только свои.
          </p>
        </div>
        {canWrite ? (
          <Button type="button" onClick={openCreate}>
            Добавить статус
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
        {statuses.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted-fg)]">
            Статусов пока нет.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]/60">
            {statuses.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/15"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.isSystem ? (
                      <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-fg)]">
                        системный
                      </span>
                    ) : null}
                  </div>
                  <p className="font-mono text-[11px] text-[var(--muted-fg)]">
                    {row.color}
                  </p>
                </div>
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => openEdit(row)}
                    >
                      Изменить
                    </Button>
                    {!row.isSystem ? (
                      <Button
                        type="button"
                        variant="danger"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !confirm(
                              `Удалить статус «${row.name}»? Это нельзя отменить.`,
                            )
                          ) {
                            return;
                          }
                          startTransition(async () => {
                            await deleteApprovalStatusAction(projectId, row.id);
                          });
                        }}
                      >
                        Удалить
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canWrite ? (
        <StatusModal
          key={editing?.id ?? "create"}
          projectId={projectId}
          status={editing}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      ) : null}
    </section>
  );
}
