"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectStatus } from "@prisma/client";
import {
  archiveProjectAction,
  deleteProjectAction,
  restoreProjectAction,
  type ActionState,
} from "@/features/projects/actions";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";

const initial: ActionState = {};

function ArchiveButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  async function handleClick() {
    if (!confirm(`Архивировать проект «${projectName}»?`)) return;
    setPending(true);
    const result = await archiveProjectAction(projectId);
    setState(result);
    setPending(false);
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={handleClick} disabled={pending}>
        {pending ? "…" : "Архивировать проект"}
      </Button>
      {state.error ? <p className="mt-2 text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.success ? <p className="mt-2 text-sm text-green-400">{state.success}</p> : null}
    </>
  );
}

function RestoreButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [state.success, router]);

  async function handleClick() {
    setPending(true);
    const result = await restoreProjectAction(projectId);
    setState(result);
    setPending(false);
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={handleClick} disabled={pending}>
        {pending ? "…" : "Восстановить из архива"}
      </Button>
      {state.error ? <p className="mt-2 text-sm text-[var(--danger)]">{state.error}</p> : null}
      {state.success ? <p className="mt-2 text-sm text-green-400">{state.success}</p> : null}
    </>
  );
}

export function ProjectDangerZone({
  projectId,
  projectName,
  status,
}: {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const boundDelete = deleteProjectAction.bind(null, projectId);
  const [deleteState, deleteAction, deletePending] = useActionState(
    boundDelete,
    initial,
  );

  const isArchived = status === ProjectStatus.ARCHIVED;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] p-4">
        <h4 className="font-semibold">
          {isArchived ? "Восстановление" : "Архивирование"}
        </h4>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          {isArchived
            ? "Вернуть проект в список активных. Данные сохранятся."
            : "Скрыть проект из основного списка. Все данные сохранятся, проект можно восстановить."}
        </p>
        <div className="mt-3">
          {isArchived ? (
            <RestoreButton projectId={projectId} />
          ) : (
            <ArchiveButton projectId={projectId} projectName={projectName} />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <h4 className="font-semibold text-red-300">Удаление проекта</h4>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Безвозвратно удалит проект, сцены, КПП, актёров и все связанные данные.
        </p>
        <Button
          type="button"
          variant="danger"
          className="mt-3"
          onClick={() => setDeleteOpen(true)}
        >
          Удалить проект
        </Button>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Удаление проекта"
        footer={
          <div className="flex gap-3">
            <Button
              type="submit"
              form="delete-project-form"
              variant="danger"
              disabled={deletePending}
            >
              {deletePending ? "Удаление…" : "Удалить навсегда"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
            >
              Отмена
            </Button>
          </div>
        }
      >
        <form id="delete-project-form" action={deleteAction} className="space-y-4">
          <p className="text-sm text-[var(--muted-fg)]">
            Введите название проекта{" "}
            <strong className="text-[var(--foreground)]">{projectName}</strong>{" "}
            для подтверждения.
          </p>
          <div>
            <Label htmlFor="confirmName">Название проекта</Label>
            <Input id="confirmName" name="confirmName" required autoComplete="off" />
          </div>
          {deleteState.error ? (
            <p className="text-sm text-[var(--danger)]">{deleteState.error}</p>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
