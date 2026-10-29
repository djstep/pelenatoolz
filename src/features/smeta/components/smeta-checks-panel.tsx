"use client";

import { useEffect, useRef, useState } from "react";
import type { SmetaCheck } from "@/features/smeta/lib/main-sheet";
import { cn } from "@/shared/lib/cn";

/**
 * Проверки основного листа после сохранения. Не блокируют: подсвечивают строки
 * и показывают список; клик по пункту открывает строку на основном листе.
 * Полоса всегда одной высоты (даже без замечаний), список раскрывается поверх листа —
 * лист не сдвигается, когда меняется число проверок.
 */
export function SmetaChecksPanel({
  checks,
  canRestoreHeaders,
  onSelectRow,
  onRestoreHeaders,
}: {
  checks: SmetaCheck[];
  canRestoreHeaders: boolean;
  onSelectRow: (row: number) => void;
  onRestoreHeaders: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const broken = checks.some((c) => c.kind === "headers");
  const expanded = open && checks.length > 0;

  useEffect(() => {
    if (!expanded) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <div ref={rootRef} className="relative z-30 h-9 shrink-0" role="status">
      <div
        className={cn(
          "flex h-full items-center gap-3 border-b border-[var(--border)] px-4 text-sm",
          checks.length > 0 ? "bg-[var(--tone-warning-bg)]" : "bg-[var(--panel-solid)]",
        )}
      >
        {checks.length === 0 ? (
          <span className="text-xs text-[var(--muted-fg)]">Проверки: замечаний нет</span>
        ) : (
          <>
            <button
              type="button"
              className="shrink-0 font-medium text-[var(--tone-warning-strong)] hover:underline"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? "▾" : "▸"} Проверки: {checks.length}
            </button>
            {!expanded ? (
              <button
                type="button"
                className={cn(
                  "min-w-0 truncate text-left hover:underline",
                  checks[0].kind === "headers"
                    ? "text-[var(--danger)]"
                    : "text-[var(--foreground)]",
                )}
                onClick={() => onSelectRow(checks[0].row)}
                title={checks[0].message}
              >
                {checks[0].message}
              </button>
            ) : null}
          </>
        )}
        {broken && canRestoreHeaders ? (
          <button
            type="button"
            className="ml-auto shrink-0 rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--nav-hover-bg)]"
            onClick={onRestoreHeaders}
          >
            Восстановить заголовки
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="absolute inset-x-0 top-full max-h-[40vh] space-y-0.5 overflow-y-auto border-b border-[var(--border)] bg-[var(--panel-solid)] px-4 py-2 text-sm shadow-lg">
          {checks.map((check, index) => (
            <li key={`${check.kind}-${check.row}-${index}`}>
              <button
                type="button"
                className={
                  check.kind === "headers"
                    ? "text-left text-[var(--danger)] hover:underline"
                    : "text-left text-[var(--foreground)] hover:underline"
                }
                onClick={() => {
                  setOpen(false);
                  onSelectRow(check.row);
                }}
              >
                {check.message}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
