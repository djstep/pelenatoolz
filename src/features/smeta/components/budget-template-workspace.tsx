"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTemplateArticleAction,
  moveTemplateArticleAction,
  renameTemplateArticleAction,
  setTemplateArticleArchivedAction,
  type TemplateActionState,
} from "@/features/smeta/template-actions";
import type { TemplateArticleRow } from "@/features/smeta/template-queries";
import { countOf } from "@/shared/lib/plural";
import { Button } from "@/shared/ui/button";
import { submitKeepingFields } from "@/shared/ui/forms/submit-keeping-fields";
import { useSafeActionState } from "@/shared/ui/forms/use-safe-action-state";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Modal } from "@/shared/ui/modal";
import { toast, useActionToast } from "@/shared/ui/toast";
import { useActionSuccess } from "@/shared/ui/unsaved/use-action-success";

const initial: TemplateActionState = {};

function AddArticleForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useSafeActionState(
    createTemplateArticleAction.bind(null, projectId),
    initial,
  );
  useActionToast(state);
  const [name, setName] = useState("");
  useActionSuccess(state, () => setName(""));

  return (
    <form
      onSubmit={submitKeepingFields(action)}
      className="flex flex-wrap items-end gap-2 border-b border-[var(--border)] px-4 py-3"
    >
      <div className="min-w-[14rem] flex-1">
        <Label htmlFor="template-article-name">Новая статья</Label>
        <Input
          id="template-article-name"
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Транспорт"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Добавить статью"}
      </Button>
    </form>
  );
}

function RenameModal({
  projectId,
  article,
  onClose,
}: {
  projectId: string;
  article: TemplateArticleRow;
  onClose: () => void;
}) {
  const [state, action, pending] = useSafeActionState(
    renameTemplateArticleAction.bind(null, projectId, article.id),
    initial,
  );
  useActionToast(state);
  useActionSuccess(state, onClose);

  return (
    <Modal
      guardUnsaved
      open
      onClose={onClose}
      title="Переименовать статью"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button type="submit" form="template-rename-form" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </Button>
          <Button type="button" variant="secondary" data-modal-cancel onClick={onClose}>
            Отмена
          </Button>
          {state.error ? (
            <span className="w-full text-sm text-[var(--danger)]">{state.error}</span>
          ) : null}
        </div>
      }
    >
      <form id="template-rename-form" onSubmit={submitKeepingFields(action)}>
        <Label htmlFor="template-rename-name">Название</Label>
        <Input
          id="template-rename-name"
          name="name"
          required
          maxLength={120}
          defaultValue={article.name}
        />
        {article.departmentCount > 0 ? (
          <p className="mt-2 text-xs text-[var(--muted-fg)]">
            Статью взяли {countOf(article.departmentCount, ["цех", "цеха", "цехов"])} — новое название
            будет у всех.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * Общий шаблон статей сметы фильма. Продюсер добавляет, переименовывает, переставляет и убирает
 * статьи в архив; остальные видят список. Номера и коды статей на экране не показываются.
 */
export function BudgetTemplateWorkspace({
  projectId,
  articles,
  canEdit,
}: {
  projectId: string;
  articles: TemplateArticleRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<TemplateArticleRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const active = articles.filter((a) => !a.archived);
  const archived = articles.filter((a) => a.archived);

  function run(articleId: string, call: () => Promise<TemplateActionState>) {
    setBusyId(articleId);
    startTransition(async () => {
      try {
        const result = await call();
        if (result.error) toast.error(result.error);
        else router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-solid)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h3 className="font-display text-base font-bold">Статьи</h3>
          <p className="mt-1 text-sm text-[var(--muted-fg)]">
            Один список на фильм. Цеха берут статьи отсюда и добавляют в них подстатьи и строки.
          </p>
        </div>
        {canEdit ? <AddArticleForm projectId={projectId} /> : null}
        {active.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[var(--muted-fg)]">Статей пока нет.</p>
        ) : (
          <ol className="divide-y divide-[var(--border)]/60" aria-label="Статьи шаблона">
            {active.map((article, index) => (
              <li
                key={article.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
                data-template-article={article.name}
              >
                <span className="min-w-0 flex-1 font-medium">{article.name}</span>
                {article.departmentCount > 0 ? (
                  <span className="text-xs text-[var(--muted-fg)]">
                    {countOf(article.departmentCount, ["цех", "цеха", "цехов"])}
                  </span>
                ) : null}
                {canEdit ? (
                  <span className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Выше: ${article.name}`}
                      title="Выше"
                      disabled={index === 0 || busyId !== null}
                      onClick={() =>
                        run(article.id, () => moveTemplateArticleAction(projectId, article.id, "up"))
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Ниже: ${article.name}`}
                      title="Ниже"
                      disabled={index === active.length - 1 || busyId !== null}
                      onClick={() =>
                        run(article.id, () => moveTemplateArticleAction(projectId, article.id, "down"))
                      }
                    >
                      ↓
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setRenaming(article)}>
                      Переименовать
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busyId !== null}
                      onClick={() =>
                        run(article.id, () =>
                          setTemplateArticleArchivedAction(projectId, article.id, true),
                        )
                      }
                    >
                      В архив
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {archived.length > 0 ? (
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-solid)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h3 className="font-display text-base font-bold">Архив</h3>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              Статьи из архива цеха больше не берут; то, что уже взято, остаётся в сметах.
            </p>
          </div>
          <ul className="divide-y divide-[var(--border)]/60" aria-label="Архив статей">
            {archived.map((article) => (
              <li
                key={article.id}
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm text-[var(--muted-fg)]"
                data-template-article={article.name}
              >
                <span className="min-w-0 flex-1">{article.name}</span>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busyId !== null}
                    onClick={() =>
                      run(article.id, () =>
                        setTemplateArticleArchivedAction(projectId, article.id, false),
                      )
                    }
                  >
                    Вернуть
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {renaming ? (
        <RenameModal
          key={renaming.id}
          projectId={projectId}
          article={renaming}
          onClose={() => {
            setRenaming(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
