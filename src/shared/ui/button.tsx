import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "glass-btn-primary",
  secondary: "glass-btn-secondary",
  ghost:
    "text-[var(--foreground)] border border-transparent hover:bg-[rgb(var(--tint-rgb)/0.06)]",
  // Опасная: текст --danger и рамка в тон, без заливки.
  danger:
    "text-[var(--danger)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]",
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        // Высота 36 px: строка 20 + отступы 7 + рамка 1 (в тулбарах уменьшают через className).
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-[7px] text-sm leading-5 font-semibold transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
