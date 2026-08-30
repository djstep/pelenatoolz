"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type Props = {
  blockId: string | null;
  containerEl: HTMLElement | null;
  canWrite: boolean;
  hasOpenComments: boolean;
  composing: boolean;
  quote?: string;
  onStartCompose: () => void;
  onDismiss: () => void;
  onCreate: (content: string) => void;
};

export function ScreenplayBlockCommentAnchor({
  blockId,
  containerEl,
  canWrite,
  hasOpenComments,
  composing,
  quote,
  onStartCompose,
  onDismiss,
  onCreate,
}: Props) {
  const [top, setTop] = useState(0);
  const [draft, setDraft] = useState("");

  const measure = useCallback(() => {
    if (!blockId || !containerEl) return;
    const row = containerEl.querySelector(`[data-block-id="${blockId}"]`);
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    setTop(rowRect.top - containerRect.top + containerEl.scrollTop);
  }, [blockId, containerEl]);

  useEffect(() => {
    measure();
    if (!containerEl) return;

    const ro = new ResizeObserver(measure);
    ro.observe(containerEl);

    const scrollParent = containerEl.closest(".screenplay-editor-main");
    const onScroll = () => measure();
    scrollParent?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      scrollParent?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [containerEl, measure, blockId]);

  useEffect(() => {
    if (!composing) setDraft("");
  }, [composing]);

  if (!blockId || !canWrite) return null;

  return (
    <div
      className="screenplay-block-comment-anchor"
      style={{ top }}
      data-block-comment-anchor={blockId}
    >
      {composing ? (
        <div className="screenplay-comment-compose rounded-xl border border-[var(--accent)]/40 bg-[var(--surface-2)] p-3 shadow-sm">
          {quote ? (
            <>
              <div className="mb-1 text-[10px] text-[var(--muted-fg)]">
                Выделение
              </div>
              <blockquote className="mb-2 border-l-2 border-[var(--accent)] pl-2 text-xs italic text-[var(--muted-fg)]">
                {quote || "…"}
              </blockquote>
            </>
          ) : null}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="Комментарий…"
            className="glass-input w-full rounded-lg px-2 py-1.5 text-xs"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              className="px-2 py-1 text-xs"
              onClick={() => {
                onCreate(draft);
                setDraft("");
              }}
            >
              Добавить
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => {
                setDraft("");
                onDismiss();
              }}
            >
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            "screenplay-block-comment-anchor-btn",
            hasOpenComments && "screenplay-block-comment-anchor-btn--has-comments",
          )}
          title="Комментарий"
          onClick={onStartCompose}
        >
          💬
        </button>
      )}
    </div>
  );
}
