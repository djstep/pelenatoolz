"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";

type Option = { value: string; label: string };

const triggerClass =
  "inline-flex max-w-full items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--glass-badge-bg)] px-2.5 py-1 text-xs text-[var(--foreground)]";

/** Статус как надпись с обводкой; при canChange — кастомный dropdown в стиле темы. */
export function StatusSelect({
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  value: string;
  options: Option[];
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}) {
  const label = options.find((o) => o.value === value)?.label ?? value;
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (disabled || !onChange) {
    return <span className={cn(triggerClass, className)}>{label}</span>;
  }

  return (
    <div ref={containerRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={cn(triggerClass, "cursor-pointer pr-1.5")}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={cn(
            "shrink-0 text-[var(--muted-fg)] transition-transform",
            open && "rotate-180",
          )}
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="glass-dropdown absolute right-0 z-50 mt-1 min-w-[11rem] max-h-60 overflow-y-auto py-1"
        >
          {options.map((option) => (
            <li key={option.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                data-selected={option.value === value ? "true" : undefined}
                className="glass-dropdown-item text-xs"
                onClick={() => {
                  setOpen(false);
                  if (option.value !== value) onChange(option.value);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
