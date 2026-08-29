"use client";

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { cn } from "@/shared/lib/cn";
import {
  isScriptFile,
  SCRIPT_ACCEPT,
  SCRIPT_FORMAT_HINT,
} from "@/features/import/script-formats";

function formatBytes(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
}

export function FileDropzone({
  name = "file",
  accept = SCRIPT_ACCEPT,
  required,
  disabled,
  hint = "Перетащите сценарий сюда или нажмите, чтобы выбрать",
  className,
  onFileChange,
}: {
  name?: string;
  accept?: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  className?: string;
  onFileChange?: (file: File | null) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function commit(next: File | null) {
    setFile(next);
    onFileChange?.(next);

    const input = inputRef.current;
    if (!input) return;

    if (!next) {
      input.value = "";
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(next);
    input.files = transfer.files;
  }

  function handleFiles(list: FileList | null) {
    const picked = list?.[0] ?? null;
    if (!picked) {
      commit(null);
      setError(null);
      return;
    }
    if (!isScriptFile(picked)) {
      commit(null);
      setError(`Неподдерживаемый формат. ${SCRIPT_FORMAT_HINT}`);
      return;
    }
    setError(null);
    commit(picked);
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={name}
        accept={accept}
        required={required}
        disabled={disabled}
        className="sr-only"
        onChange={onInputChange}
      />

      <label
        htmlFor={inputId}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "group relative flex min-h-[9.5rem] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-8 text-center transition-all duration-200",
          "bg-white/[0.03] backdrop-blur-md",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_32px_rgba(110,168,255,0.18)]"
            : "border-[var(--border-strong)] hover:border-[var(--accent)]/60 hover:bg-white/[0.05]",
          disabled && "pointer-events-none opacity-60",
          file && !dragging && "border-solid border-[var(--accent)]/45 bg-[var(--accent)]/8",
        )}
      >
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--muted-fg)] transition",
            (dragging || file) && "border-[var(--accent)]/40 text-[var(--accent)]",
          )}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 16V4m0 0l-4 4m4-4l4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {file ? (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              {file.name}
            </p>
            <p className="text-xs text-[var(--muted-fg)]">
              {formatBytes(file.size)} · нажмите, чтобы заменить
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              {hint}
            </p>
            <p className="text-xs text-[var(--muted-fg)]">
              {SCRIPT_FORMAT_HINT}
            </p>
          </div>
        )}
      </label>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted-fg)]">
          Fade In / WriterDuet / Highland — .fdx или .fountain; КИТ — .kitsp
        </p>
        {file ? (
          <button
            type="button"
            className="text-xs text-[var(--muted-fg)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
            onClick={() => {
              commit(null);
              setError(null);
            }}
          >
            Убрать файл
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
