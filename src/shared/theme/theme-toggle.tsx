"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/shared/theme/theme-provider";
import { cn } from "@/shared/lib/cn";

function SunIcon() {
  return <Sun className="h-4 w-4" strokeWidth={1.75} aria-hidden />;
}

function MoonIcon() {
  return <Moon className="h-4 w-4" strokeWidth={1.75} aria-hidden />;
}

/**
 * Переключатель темы. `iconOnly` — только значок (низ бокового меню проекта): цвет и фон
 * задаёт `className`, значок — цветом текста кнопки.
 */
export function ThemeToggle({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const { theme, toggleTheme, ready } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors duration-150",
        "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
        "hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]",
        className,
      )}
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
      title={isDark ? "Светлая тема" : "Тёмная тема"}
    >
      <span className={iconOnly ? undefined : "text-[var(--muted-fg)]"} suppressHydrationWarning>
        {ready ? (isDark ? <SunIcon /> : <MoonIcon />) : <SunIcon />}
      </span>
      {iconOnly ? null : (
        <span className="hidden sm:inline" suppressHydrationWarning>
          {ready ? (isDark ? "Светлая" : "Тёмная") : "Тема"}
        </span>
      )}
    </button>
  );
}
