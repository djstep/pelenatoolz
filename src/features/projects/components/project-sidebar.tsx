"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/shared/lib/cn";

/**
 * Боковое меню проекта — тёмное в обеих темах (`--sidebar-*`). От `lg` — колонка слева на всю
 * высоту: логотип, блок проекта, разделы, внизу пользователь и тема (шапки в проекте нет).
 * Уже `lg` — свёрнуто: сверху полоса с логотипом, темой и «Меню аккаунта», под ней — название
 * проекта и кнопка «Меню»; первым экраном идёт содержимое страницы. По «Меню» панель
 * открывается поверх страницы и закрывается переходом, «Закрыть» или Esc.
 */
export function ProjectSidebar({
  projectName,
  brand,
  mobileAccount,
  footer,
  children,
}: {
  projectName: string;
  /** Логотип со ссылкой на список проектов. */
  brand: React.ReactNode;
  /** Тема и «Меню аккаунта» в полосе телефона. */
  mobileAccount: React.ReactNode;
  /** Низ колонки на компьютере: пользователь и тема. */
  footer: React.ReactNode;
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
    <aside className="project-sidebar brand-on-dark flex w-full shrink-0 flex-col text-[var(--sidebar-fg)] lg:h-full lg:w-[248px] lg:flex-col lg:border-r lg:border-[var(--sidebar-line)]">
      <div
        id="project-menu"
        className={cn(
          "lg:static lg:flex lg:min-h-0 lg:flex-1 lg:flex-col",
          open ? "project-sidebar fixed inset-0 z-40 flex flex-col overflow-y-auto" : "hidden",
        )}
      >
        <div className="hidden px-4 pb-2 pt-5 lg:block">{brand}</div>
        <div className="flex-1 space-y-3 px-3 py-4 lg:min-h-0 lg:overflow-y-auto lg:pt-2">
          {open ? (
            <div className="flex justify-end lg:hidden">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-[var(--sidebar-fg-2)] transition-colors hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-fg)]"
              >
                Закрыть
              </button>
            </div>
          ) : null}
          {children}
        </div>
        <div className="hidden border-t border-[var(--sidebar-line)] px-3 py-2.5 lg:block">{footer}</div>
      </div>
      {/* Телефон: полосы сверху. В разметке — после меню (на экране — первыми, order-first):
          первый текст страницы на компьютере — видимый блок проекта, а не скрытая полоса. */}
      <div className="order-first lg:hidden">
        <div className="flex h-13 items-center justify-between gap-3 border-b border-[var(--sidebar-line)] px-4 lg:hidden">
          {brand}
          {mobileAccount}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2 lg:hidden">
          <span className="min-w-0 truncate text-base font-bold">{projectName}</span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="project-menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--sidebar-line)] px-3 text-sm font-semibold text-[var(--sidebar-fg)] transition-colors hover:bg-[var(--sidebar-hover)]"
          >
            <Menu className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            Меню
          </button>
        </div>
      </div>
    </aside>
  );
}
