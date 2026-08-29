import { type ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "glass-btn-primary",
  secondary: "glass-btn-secondary",
  ghost:
    "text-[var(--foreground)] hover:bg-white/8 border border-transparent hover:border-[var(--border)]",
  danger:
    "bg-[rgba(251,113,133,0.1)] text-[var(--danger)] border border-[rgba(251,113,133,0.35)] hover:bg-[rgba(251,113,133,0.18)] backdrop-blur-md",
};

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
