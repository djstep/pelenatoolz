"use client";

import { useState } from "react";
import type { SmetaCheck } from "@/features/smeta/lib/main-sheet";

/**
 * Проверки основного листа после сохранения. Не блокируют: подсвечивают строки
 * и показывают список; клик по пункту открывает строку на основном листе.
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
  const [open, setOpen] = useState(true);
  if (checks.length === 0) return null;

  const broken = checks.some((c) => c.kind === "headers");

  return (
    <div
      className="shrink-0 border-b border-[var(--border)] bg-[var(--tone-warning-bg)] px-4 py-2 text-sm"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="font-medium text-[var(--tone-warning-strong)] hover:underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "▾" : "▸"} Проверки: {checks.length}
        </button>
        {broken && canRestoreHeaders ? (
          <button
            type="button"
            className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--foreground)] hover:bg-[var(--nav-hover-bg)]"
            onClick={onRestoreHeaders}
          >
            Восстановить заголовки
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto pr-2">
          {checks.map((check, index) => (
            <li key={`${check.kind}-${check.row}-${index}`}>
              <button
                type="button"
                className={
                  check.kind === "headers"
                    ? "text-left text-[var(--danger)] hover:underline"
                    : "text-left text-[var(--foreground)] hover:underline"
                }
                onClick={() => onSelectRow(check.row)}
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
