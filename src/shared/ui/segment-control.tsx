"use client";

import { cn } from "@/shared/lib/cn";

export function SegmentControl<T extends string>({
  name,
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <input type="hidden" name={name} value={value} />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            className={cn(
              "rounded-xl border px-4 py-2 text-sm transition-all duration-150",
              selected
                ? "border-[var(--accent)] bg-[var(--accent)]/20 text-white shadow-[0_0_20px_rgba(110,168,255,0.12)]"
                : "border-[var(--border)] bg-white/5 text-[var(--muted-fg)] hover:border-[var(--border-strong)] hover:bg-white/10 hover:text-[var(--foreground)]",
              disabled && "cursor-not-allowed opacity-60",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
