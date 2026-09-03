"use client";

import { useState, useTransition } from "react";
import {
  addCastingCandidateCommentAction,
  deleteCastingCandidateCommentAction,
} from "@/features/casting/actions-cast-list-export";
import { formatDateShort } from "@/shared/i18n/format-date";
import { Button } from "@/shared/ui/button";
import { useToast } from "@/shared/ui/toast";

export type CandidateCommentView = {
  id: string;
  body: string;
  createdAt: string | Date;
  authorName: string;
  authorId?: string;
};

export function CastingCandidateComments({
  projectId,
  candidateId,
  comments,
  canWrite,
}: {
  projectId: string;
  candidateId: string;
  comments: CandidateCommentView[];
  canWrite: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");

  function submit() {
    const body = text.trim();
    if (!body) return;
    start(async () => {
      const r = await addCastingCandidateCommentAction(
        projectId,
        candidateId,
        body,
      );
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.success ?? "Добавлено");
        setText("");
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--muted-fg)]">Комментарии</p>
      {comments.length === 0 ? (
        <p className="text-xs text-[var(--muted-fg)]">Пока нет</p>
      ) : (
        <ul className="space-y-1.5">
          {comments.map((cm) => (
            <li
              key={cm.id}
              className="rounded-lg border border-[var(--border)]/50 px-2 py-1.5 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium">
                  {cm.authorName} · {formatDateShort(cm.createdAt)}
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    className="text-[var(--muted-fg)] hover:text-[var(--danger)]"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteCastingCandidateCommentAction(
                          projectId,
                          cm.id,
                        );
                        if (r.error) toast.error(r.error);
                        else toast.success(r.success ?? "Удалено");
                      })
                    }
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              <p className="mt-0.5 text-[var(--foreground)]">{cm.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <div className="flex gap-2">
          <input
            className="glass-input min-w-0 flex-1 rounded-xl px-3 py-1.5 text-sm"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Новый комментарий…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !text.trim()}
            onClick={submit}
          >
            +
          </Button>
        </div>
      ) : null}
    </div>
  );
}
