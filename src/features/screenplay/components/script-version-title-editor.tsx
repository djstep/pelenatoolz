"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameScriptVersionAction } from "@/features/screenplay/actions";
import { versionLabel } from "@/features/screenplay/lib/version-label";
import { cn } from "@/shared/lib/cn";

type Props = {
  projectId: string;
  versionId: string;
  versionNumber: number;
  title: string | null;
  canWrite: boolean;
  variant?: "table" | "heading";
  className?: string;
};

export function ScriptVersionTitleEditor({
  projectId,
  versionId,
  versionNumber,
  title,
  canWrite,
  variant = "table",
  className,
}: Props) {
  const router = useRouter();
  const skipBlurSave = useRef(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setValue(title ?? "");
  }, [title]);

  function startEditing() {
    if (!canWrite || pending) return;
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setValue(title ?? "");
    setEditing(false);
    setError(null);
  }

  function save() {
    const next = value.trim();
    const current = (title ?? "").trim();
    if (next === current) {
      setEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await renameScriptVersionAction(projectId, versionId, value);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  const display = versionLabel({ versionNumber, title });
  const placeholder = `Версия ${versionNumber}`;

  if (!canWrite) {
    return <span className={className}>{display}</span>;
  }

  if (editing) {
    return (
      <div className={cn("flex min-w-[10rem] flex-col gap-1", className)}>
        <input
          autoFocus
          value={value}
          disabled={pending}
          placeholder={placeholder}
          className={cn(
            "glass-input w-full rounded-lg px-2 text-[var(--foreground)] placeholder:text-[var(--muted)]",
            variant === "heading" ? "h-9 text-lg font-semibold" : "h-8 text-sm",
          )}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
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
      title="Нажмите, чтобы изменить название"
      className={cn(
        "group inline-flex max-w-full items-center gap-2 rounded-md text-left transition-colors",
        "hover:bg-[var(--surface-2)]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
        variant === "heading" ? "px-1 py-0.5 text-xl font-semibold" : "px-1 py-0.5 text-sm",
        className,
      )}
    >
      <span className="truncate">{display}</span>
      <span className="shrink-0 text-[10px] text-[var(--muted-fg)] opacity-0 transition-opacity group-hover:opacity-100">
        ✎
      </span>
    </button>
  );
}
