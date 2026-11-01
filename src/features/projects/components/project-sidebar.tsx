"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Боковая панель проекта. От `lg` — колонка слева, как раньше. Уже — свёрнута: строка
 * с названием проекта и кнопкой «Меню», первым экраном идёт содержимое страницы; по кнопке
 * панель открывается поверх страницы и закрывается переходом, «Закрыть» или Esc.
 */
export function ProjectSidebar({
  projectName,
  children,
}: {
  projectName: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  if (pathname !== seenPath) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <aside className="w-full shrink-0 border-b border-[var(--border)] lg:w-60 lg:border-b-0 lg:border-r">
      <div className="project-sidebar flex items-center justify-between gap-3 px-4 py-2 lg:hidden">
        <span className="min-w-0 truncate font-display text-base font-semibold">{projectName}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="project-menu"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium transition hover:bg-[var(--surface-2)]"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
            <path
              fillRule="evenodd"
              d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
              clipRule="evenodd"
            />
          </svg>
          Меню
        </button>
      </div>
      <div
        id="project-menu"
        className={cn(
          "lg:static lg:block lg:h-full lg:bg-transparent",
          open ? "fixed inset-x-0 bottom-0 top-14 z-40 overflow-y-auto bg-[var(--background)]" : "hidden",
        )}
      >
        <div className="project-sidebar space-y-4 px-3 py-5 lg:h-full lg:max-h-none lg:overflow-y-auto lg:backdrop-blur-md">
          {open ? (
            <div className="flex justify-end lg:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-fg)] transition hover:bg-[var(--nav-hover-bg)] hover:text-[var(--foreground)]"
              >
                Закрыть
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </aside>
  );
}
