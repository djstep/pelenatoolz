"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Выпадающее меню аккаунта в шапке.
 * Без `trigger` — телефон: кнопка-«гамбургер», «Проекты», профиль и «Выйти» (на ширине от `sm` скрыто).
 * С `trigger` — меню пользователя на компьютере: кнопка с инициалами и именем → «Профиль», «Выйти».
 * `placement="top"` — список над кнопкой (низ бокового меню проекта); `triggerClassName` — вид кнопки.
 */
export function HeaderMenu({
  children,
  trigger,
  label = "Меню аккаунта",
  className = "relative sm:hidden",
  placement = "bottom",
  triggerClassName,
}: {
  children: React.ReactNode;
  trigger?: React.ReactNode;
  label?: string;
  className?: string;
  placement?: "bottom" | "top";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={className}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={
          triggerClassName ??
          (trigger
            ? "inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 pl-1 pr-3 text-[var(--foreground)] transition hover:bg-[var(--surface-2)]"
            : "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] transition hover:bg-[var(--surface-2)]")
        }
      >
        {trigger ?? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
            <path
              fillRule="evenodd"
              d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className={
            placement === "top"
              ? "glass-dropdown absolute bottom-full left-0 z-50 mb-2 flex min-w-[12rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden text-sm"
              : "glass-dropdown absolute right-0 top-full z-50 mt-2 flex min-w-[12rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden text-sm"
          }
          onClick={(e) => {
            // Переход по ссылке меню закрывает его сразу (до смены адреса).
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
