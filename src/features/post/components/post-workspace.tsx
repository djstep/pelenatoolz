"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { PostStage, PostTaskStatus } from "@prisma/client";
import {
  createPostTaskAction,
  deletePostTaskAction,
  setPostTaskStatusAction,
  updatePostTaskAction,
  type PostActionState,
} from "@/features/post/actions";
import {
  postStageLabels,
  postTaskStatusColors,
  postTaskStatusLabels,
} from "@/shared/i18n/finance-post-labels";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { Select } from "@/shared/ui/select";
import { cn } from "@/shared/lib/cn";

const initial: PostActionState = {};

type Task = {
  id: string;
  stage: PostStage;
  status: PostTaskStatus;
  title: string;
  episodeNumber: number | null;
  assignee: string | null;
  dueDate: Date | null;
  notes: string | null;
};

const STAGES = Object.keys(postStageLabels) as PostStage[];

function TaskForm({ task }: { task?: Task }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor="title">Задача *</Label>
        <Input
          id="title"
          name="title"
          required
          defaultValue={task?.title}
          placeholder="Черновой монтаж эп. 1 / сведение диалогов…"
        />
      </div>
      <div>
        <Label htmlFor="stage">Этап</Label>
        <Select id="stage" name="stage" defaultValue={task?.stage ?? "EDIT"}>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {postStageLabels[s]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="status">Статус</Label>
        <Select
          id="status"
          name="status"
          defaultValue={task?.status ?? "TODO"}
        >
          {(Object.keys(postTaskStatusLabels) as PostTaskStatus[]).map((s) => (
            <option key={s} value={s}>
              {postTaskStatusLabels[s]}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="episodeNumber">Эпизод</Label>
        <Input
          id="episodeNumber"
          name="episodeNumber"
          type="number"
          min={0}
          defaultValue={task?.episodeNumber ?? undefined}
          placeholder="0 = фильм"
        />
      </div>
      <div>
        <Label htmlFor="dueDate">Срок</Label>
        <Input
          id="dueDate"
          name="dueDate"
          type="date"
          defaultValue={
            task?.dueDate
              ? new Date(task.dueDate).toISOString().slice(0, 10)
              : ""
          }
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="assignee">Ответственный</Label>
        <Input
          id="assignee"
          name="assignee"
          defaultValue={task?.assignee ?? ""}
          placeholder="Имя / роль"
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="notes">Заметки</Label>
        <Input id="notes" name="notes" defaultValue={task?.notes ?? ""} />
      </div>
    </div>
  );
}

function TaskModal({
  projectId,
  task,
  open,
  onClose,
}: {
  projectId: string;
  task?: Task;
  open: boolean;
  onClose: () => void;
}) {
  const bound = task
    ? updatePostTaskAction.bind(null, projectId, task.id)
    : createPostTaskAction.bind(null, projectId);
  const [state, action, pending] = useActionState(bound, initial);

  useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Редактирование задачи" : "Новая задача поста"}
      footer={
        <div className="flex gap-3">
          <Button type="submit" form="post-task-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          {state.error ? (
            <span className="text-sm text-[var(--danger)]">{state.error}</span>
          ) : null}
        </div>
      }
    >
      <form id="post-task-form" action={action} key={task?.id ?? "new"}>
        <TaskForm task={task} />
      </form>
    </Modal>
  );
}

export function PostWorkspace({
  projectId,
  tasks,
  canWrite,
}: {
  projectId: string;
  tasks: Task[];
  canWrite: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const stats = useMemo(() => {
    const s = { TODO: 0, IN_PROGRESS: 0, DONE: 0, BLOCKED: 0 };
    for (const t of tasks) s[t.status] += 1;
    return s;
  }, [tasks]);

  const byStage = useMemo(() => {
    return STAGES.map((stage) => ({
      stage,
      items: tasks.filter((t) => t.stage === stage),
    })).filter((g) => g.items.length > 0 || true);
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {(Object.keys(postTaskStatusLabels) as PostTaskStatus[]).map(
          (status) => (
            <div
              key={status}
              className="rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] p-4"
            >
              <div className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">
                {postTaskStatusLabels[status]}
              </div>
              <div className="mt-1 text-xl font-semibold">{stats[status]}</div>
            </div>
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {canWrite ? (
          <Button type="button" onClick={() => setCreating(true)}>
            + Задача
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {byStage.map(({ stage, items }) => (
          <section
            key={stage}
            className="flex min-h-[12rem] flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)]"
          >
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h3 className="font-semibold">{postStageLabels[stage]}</h3>
              <p className="text-xs text-[var(--muted-fg)]">
                {items.length} задач
              </p>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              {items.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--muted-fg)]">
                  Пусто
                </p>
              ) : (
                items.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-white/10 bg-[#121a2a] p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium leading-snug">
                          {task.title}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[var(--muted-fg)]">
                          {task.episodeNumber != null &&
                          task.episodeNumber > 0 ? (
                            <span>Эп. {task.episodeNumber}</span>
                          ) : null}
                          {task.assignee ? <span>{task.assignee}</span> : null}
                          {task.dueDate ? (
                            <span>
                              до {formatDateShort(task.dueDate)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-md border px-2 py-0.5 text-[11px]",
                          postTaskStatusColors[task.status],
                        )}
                      >
                        {postTaskStatusLabels[task.status]}
                      </span>
                    </div>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(
                          Object.keys(postTaskStatusLabels) as PostTaskStatus[]
                        ).map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={task.status === status}
                            className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted-fg)] hover:bg-white/10 disabled:opacity-40"
                            onClick={() =>
                              void setPostTaskStatusAction(
                                projectId,
                                task.id,
                                status,
                              )
                            }
                          >
                            {postTaskStatusLabels[status]}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="ml-auto rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
                          onClick={() => setEditing(task)}
                        >
                          Изменить
                        </button>
                        <form
                          action={async () => {
                            await deletePostTaskAction(projectId, task.id);
                          }}
                        >
                          <button
                            type="submit"
                            className="rounded px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-500/15"
                          >
                            Удалить
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>
        ))}
      </div>

      <TaskModal
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
      />
      <TaskModal
        projectId={projectId}
        task={editing ?? undefined}
        open={editing != null}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
