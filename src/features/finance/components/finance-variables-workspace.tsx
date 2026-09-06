"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createCustomFinanceVariableAction,
  deleteCustomFinanceVariableAction,
  resetSystemFinanceVariableAction,
  updateCustomFinanceVariableAction,
  upsertSystemFinanceVariableAction,
  type FinanceVariableActionState,
} from "@/features/finance/actions-variables";
import type { FinanceVariableRow } from "@/features/finance/queries-variables";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { useActionToast } from "@/shared/ui/toast";

const initial: FinanceVariableActionState = {};

function SystemVariableRow({
  projectId,
  variable,
  canWrite,
}: {
  projectId: string;
  variable: FinanceVariableRow;
  canWrite: boolean;
}) {
  const bound = upsertSystemFinanceVariableAction.bind(
    null,
    projectId,
    variable.key,
  );
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);

  return (
    <form
      action={action}
      className="grid gap-3 border-b border-[var(--border)]/60 px-4 py-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
    >
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{variable.label}</span>
          <span className="rounded-md border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-fg)]">
            {variable.key}
          </span>
          {variable.fromProjectDefault ? (
            <span className="text-[10px] text-emerald-400/90">
              из параметров проекта
            </span>
          ) : (
            <span className="text-[10px] text-amber-300/90">переопределено</span>
          )}
        </div>
        {variable.description ? (
          <p className="mt-1 text-xs text-[var(--muted-fg)]">
            {variable.description}
            {variable.projectDefault != null
              ? ` · сейчас в проекте: ${variable.projectDefault}`
              : " · в проекте не задано"}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor={`val-${variable.key}`}>Значение</Label>
        <Input
          id={`val-${variable.key}`}
          name="value"
          type="number"
          min={0}
          step="any"
          defaultValue={variable.value}
          disabled={!canWrite || pending}
          required
        />
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          {!variable.fromProjectDefault ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                void resetSystemFinanceVariableAction(projectId, variable.key);
              }}
            >
              Сбросить
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function CustomVariableModal({
  projectId,
  variable,
  open,
  onClose,
}: {
  projectId: string;
  variable?: FinanceVariableRow;
  open: boolean;
  onClose: () => void;
}) {
  const bound =
    variable?.id != null
      ? updateCustomFinanceVariableAction.bind(null, projectId, variable.id)
      : createCustomFinanceVariableAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);
  useActionToast(state);
  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={variable ? "Редактирование переменной" : "Новая переменная"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="finance-var-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      <form
        id="finance-var-form"
        action={action}
        key={variable?.id ?? "new"}
        className="grid gap-3"
      >
        <div>
          <Label htmlFor="label">Название *</Label>
          <Input
            id="label"
            name="label"
            required
            defaultValue={variable?.label}
            placeholder="НАПРИМЕР_ЛОКАЦИИ"
          />
        </div>
        <div>
          <Label htmlFor="value">Значение *</Label>
          <Input
            id="value"
            name="value"
            type="number"
            min={0}
            step="any"
            required
            defaultValue={variable?.value ?? 0}
          />
        </div>
        <div>
          <Label htmlFor="notes">Заметка</Label>
          <Input id="notes" name="notes" defaultValue={variable?.notes ?? ""} />
        </div>
      </form>
    </Modal>
  );
}

export function FinanceVariablesWorkspace({
  projectId,
  variables,
  canWrite,
}: {
  projectId: string;
  variables: FinanceVariableRow[];
  canWrite: boolean;
}) {
  const system = variables.filter((v) => v.isSystem);
  const custom = variables.filter((v) => !v.isSystem);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FinanceVariableRow | null>(null);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-semibold">Переменные проекта</h3>
          <p className="mt-1 text-xs text-[var(--muted-fg)]">
            «СМЕНЫ» и «СЕРИИ» по умолчанию берутся из параметров проекта
            (создание / настройки), но здесь их можно переопределить для
            расчётов в статьях сметы.
          </p>
        </div>
        {system.map((v) => (
          <SystemVariableRow
            key={v.key}
            projectId={projectId}
            variable={v}
            canWrite={canWrite}
          />
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h3 className="font-semibold">Свои переменные</h3>
            <p className="mt-1 text-xs text-[var(--muted-fg)]">
              Для нестандартных расчётов количества в статьях бюджета.
            </p>
          </div>
          {canWrite ? (
            <Button type="button" onClick={() => setCreating(true)}>
              + Переменная
            </Button>
          ) : null}
        </div>

        {custom.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted-fg)]">
            Пока нет кастомных переменных.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted-fg)]">
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Ключ</th>
                <th className="px-4 py-3">Значение</th>
                {canWrite ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody>
              {custom.map((v) => (
                <tr key={v.key} className="border-b border-[var(--border)]/60">
                  <td className="px-4 py-3 font-medium">
                    {v.label}
                    {v.notes ? (
                      <div className="text-xs text-[var(--muted-fg)]">
                        {v.notes}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-fg)]">{v.key}</td>
                  <td className="px-4 py-3">{v.value}</td>
                  {canWrite ? (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setEditing(v)}
                        >
                          Изменить
                        </Button>
                        <form
                          action={async () => {
                            if (v.id) {
                              await deleteCustomFinanceVariableAction(
                                projectId,
                                v.id,
                              );
                            }
                          }}
                        >
                          <Button type="submit" variant="danger">
                            ×
                          </Button>
                        </form>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CustomVariableModal
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <CustomVariableModal
        projectId={projectId}
        variable={editing ?? undefined}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
