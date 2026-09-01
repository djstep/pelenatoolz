"use client";

import { useState } from "react";
import type { ScriptCommentThread } from "@/features/screenplay/lib/comment-types";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/i18n/format-date";

type Props = {
  threads: ScriptCommentThread[];
  canWrite: boolean;
  onReply: (parentId: string, content: string) => void;
  onResolve: (commentId: string, resolved: boolean) => void;
  onDelete: (commentId: string) => void;
};

function formatDate(iso: string) {
  return formatDateTimeShort(iso);
}

export function ScreenplayCommentsMargin({
  threads,
  canWrite,
  onReply,
  onResolve,
  onDelete,
}: Props) {
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  if (threads.length === 0) return null;

  return (
    <aside className="screenplay-comments-margin">
      {threads.map((thread) => (
        <div
          key={thread.id}
          className={cn(
            "screenplay-comment-card mb-3 rounded-xl border p-3 text-xs",
            thread.status === "RESOLVED"
              ? "border-[var(--border)] bg-[var(--surface-2)]/50 opacity-70"
              : "border-yellow-500/30 bg-yellow-500/10",
          )}
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">{thread.author.name}</div>
              <div className="text-[10px] text-[var(--muted-fg)]">
                {formatDate(thread.createdAt)}
              </div>
            </div>
            {canWrite ? (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  title={thread.status === "RESOLVED" ? "Открыть" : "Решено"}
                  className="text-[10px] text-[var(--muted-fg)] hover:text-[var(--foreground)]"
                  onClick={() =>
                    onResolve(thread.id, thread.status !== "RESOLVED")
                  }
                >
                  {thread.status === "RESOLVED" ? "↺" : "✓"}
                </button>
                <button
                  type="button"
                  title="Удалить"
                  className="text-[10px] text-[var(--danger)]"
                  onClick={() => onDelete(thread.id)}
                >
                  ×
                </button>
              </div>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap">{thread.content}</p>

          {thread.replies.map((reply) => (
            <div
              key={reply.id}
              className="mt-2 border-l-2 border-[var(--border)] pl-2"
            >
              <div className="font-medium">{reply.author.name}</div>
              <div className="text-[10px] text-[var(--muted-fg)]">
                {formatDate(reply.createdAt)}
              </div>
              <p className="whitespace-pre-wrap">{reply.content}</p>
            </div>
          ))}

          {canWrite && thread.status === "OPEN" ? (
            <div className="mt-2">
              <input
                value={replyDrafts[thread.id] ?? ""}
                onChange={(event) =>
                  setReplyDrafts((prev) => ({
                    ...prev,
                    [thread.id]: event.target.value,
                  }))
                }
                placeholder="Ответ…"
                className="glass-input w-full rounded-lg px-2 py-1 text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const text = replyDrafts[thread.id] ?? "";
                    if (text.trim()) {
                      onReply(thread.id, text);
                      setReplyDrafts((prev) => ({ ...prev, [thread.id]: "" }));
                    }
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </aside>
  );
}
