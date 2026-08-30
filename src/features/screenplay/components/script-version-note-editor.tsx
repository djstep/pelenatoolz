"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { updateScriptVersionNoteAction } from "@/features/screenplay/actions";
import { cn } from "@/shared/lib/cn";

type Props = {
  projectId: string;
  versionId: string;
  note: string | null;
  canWrite: boolean;
  variant?: "table" | "heading";
  className?: string;
};

export function ScriptVersionNoteEditor({
  projectId,
  versionId,
  note,
  canWrite,
  variant = "table",
  className,
}: Props) {
  const router = useRouter();
  const skipBlurSave = useRef(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setValue(note ?? "");
  }, [note]);

  function startEditing() {
    if (!canWrite || pending) return;
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setValue(note ?? "");
    setEditing(false);
    setError(null);
  }

  function save() {
    const next = value.trim();
    const current = (note ?? "").trim();
    if (next === current) {
      setEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await updateScriptVersionNoteAction(
        projectId,
        versionId,
        value,
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  const placeholder =
    variant === "heading"
      ? "Комментарий к версии (заметка для команды)…"
      : "Комментарий…";

  if (!canWrite) {
    return (
      <span
        className={cn(
          "text-[var(--muted-fg)]",
          variant === "heading" ? "text-sm" : "text-xs",
          className,
        )}
      >
        {note?.trim() || "—"}
      </span>
    );
  }

  if (editing) {
    return (
      <div className={cn("flex min-w-[12rem] flex-col gap-1", className)}>
        <textarea
          autoFocus
          value={value}
          disabled={pending}
          rows={variant === "heading" ? 2 : 2}
          placeholder={placeholder}
          className={cn(
            "glass-input w-full resize-y rounded-lg px-2 py-1.5 text-[var(--foreground)] placeholder:text-[var(--muted)]",
            variant === "heading" ? "text-sm" : "text-xs",
          )}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              skipBlurSave.current = true;
              cancel();
            }
          }}
          onBlur={() => {
            if (skipBlurSave.current) {
              skipBlurSave.current = false;
              return;
            }
            save();
          }}
        />
        {error ? <span className="text-xs text-[var(--danger)]">{error}</span> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={startEditing}
      title="Нажмите, чтобы изменить комментарий"
      className={cn(
        "group w-full rounded-md text-left transition-colors",
        "hover:bg-[var(--surface-2)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
        variant === "heading" ? "px-1 py-1 text-sm" : "px-1 py-0.5 text-xs",
        note?.trim()
          ? "text-[var(--foreground)]"
          : "text-[var(--muted-fg)] italic",
        className,
      )}
    >
      <span className="line-clamp-2 whitespace-pre-wrap">
        {note?.trim() || placeholder}
      </span>
      <span className="mt-0.5 block text-[10px] text-[var(--muted-fg)] opacity-0 transition-opacity group-hover:opacity-100">
        ✎ изменить
      </span>
    </button>
  );
}
