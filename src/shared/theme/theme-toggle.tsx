"use client";

import { useTheme } from "@/shared/theme/theme-provider";
import { cn } from "@/shared/lib/cn";

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path d="M10 3a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 3zm0 11.25a2.75 2.75 0 100-5.5 2.75 2.75 0 000 5.5zM4.72 4.72a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06L4.72 5.78a.75.75 0 010-1.06zm9.48 9.48a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zM3 10a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5A.75.75 0 013 10zm12.25 0a.75.75 0 01.75-.75h1.5a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM5.78 14.22a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zm9.48-9.48a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0z" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
      <path
        fillRule="evenodd"
        d="M9.528 2.25a.75.75 0 01.962.74v.12a6.75 6.75 0 001.34 3.69.75.75 0 01-.23 1.01l-.12.09a.75.75 0 00-.24.92 6.82 6.82 0 003.18 3.18.75.75 0 00.92-.24l.09-.12a.75.75 0 011.01-.23 6.75 6.75 0 003.69 1.34h.12a.75.75 0 01.74.96 8.25 8.25 0 01-16.5 0 .75.75 0 01.74-.96h.12a6.75 6.75 0 003.69-1.34.75.75 0 011.01.23l.09.12a.75.75 0 00.92.24 6.82 6.82 0 003.18-3.18.75.75 0 00-.24-.92l-.12-.09a.75.75 0 01-.23-1.01 6.75 6.75 0 001.34-3.69v-.12a.75.75 0 01.96-.74 8.25 8.25 0 010 16.5.75.75 0 01-.96-.74v-.12a6.75 6.75 0 00-1.34-3.69.75.75 0 01.23-1.01l.12-.09a.75.75 0 00.24-.92 6.82 6.82 0 00-3.18-3.18.75.75 0 00-.92.24l-.09.12a.75.75 0 01-1.01.23 6.75 6.75 0 00-3.69-1.34h-.12a.75.75 0 01-.74-.96z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, ready } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-all duration-200",
        "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]",
        className,
      )}
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={isDark ? "Светлая тема" : "Тёмная тема"}
    >
      <span className="text-[var(--muted-fg)]" suppressHydrationWarning>
        {ready ? (isDark ? <SunIcon /> : <MoonIcon />) : <SunIcon />}
      </span>
      <span className="hidden sm:inline" suppressHydrationWarning>
        {ready ? (isDark ? "Светлая" : "Тёмная") : "Тема"}
      </span>
    </button>
  );
}
